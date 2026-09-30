// Passkey sign-in and registration through the real Better Auth handler, with a software
// authenticator standing in for the browser (the E2E uses Chromium's virtual authenticator).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { createAuth, PASSKEY_RATE_LIMITS, verifyOwnerSession, type Auth } from "@/lib/auth";
import { resolveAuthEnv } from "@/lib/auth-env";
import { authPasskeys, authSessions, authUsers } from "@/modules/core/db/auth-schema";
import { upsertOwner } from "@/modules/core/owner";
import { listPasskeys } from "@/modules/core/passkeys";
import { SoftwareAuthenticator } from "./support/software-authenticator";
import { testDb } from "./test-db";

const BASE_URL = "http://localhost:3417";
const RP_ID = "localhost";
const OWNER = "owner@example.com";
const OTHER = "someone@example.com";
const PASSWORD = "correct horse battery";
const ENV = {
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: BASE_URL,
  OWNER_EMAIL: OWNER,
  NODE_ENV: "test",
};

let ipCounter = 0;
/** A fresh client IP per call site, so tests never share a rate-limit bucket. */
const nextIp = () => `198.51.100.${++ipCounter % 250}`;

/** `name=value` pairs from Set-Cookie headers, merged into an existing Cookie header. */
function withCookies(response: Response, cookie = ""): string {
  const jar = new Map(
    cookie
      .split("; ")
      .filter(Boolean)
      .map((pair) => [pair.split("=")[0], pair] as const),
  );
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(";")[0];
    jar.set(pair.split("=")[0], pair);
  }
  return [...jar.values()].join("; ");
}

function hasSessionCookie(response: Response): boolean {
  return response.headers
    .getSetCookie()
    .some((value) => /^better-auth\.session_token=[^;]+/.test(value));
}

function get(path: string, { cookie = "", ip = nextIp() } = {}) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      headers: { cookie, "x-forwarded-for": ip },
    }),
  );
}

function post(path: string, body: unknown, { cookie = "", ip = nextIp() } = {}) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        cookie,
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    }),
  );
}

async function signInWithPassword(): Promise<string> {
  const response = await post("/sign-in/email", { email: OWNER, password: PASSWORD });
  expect(response.status).toBe(200);
  return withCookies(response);
}

/** Full registration ceremony for the signed-in owner. */
async function registerPasskey(
  authenticator: SoftwareAuthenticator,
  session: string,
  name?: string,
) {
  const optionsResponse = await get("/passkey/generate-register-options", { cookie: session });
  expect(optionsResponse.status).toBe(200);
  const options = await optionsResponse.json();
  const cookie = withCookies(optionsResponse, session);
  return {
    options,
    response: await post(
      "/passkey/verify-registration",
      { response: authenticator.register(options), name },
      { cookie },
    ),
  };
}

/** Full sign-in ceremony, signed out. `origin` lets a test forge where the browser was. */
async function signInWithPasskey(
  authenticator: SoftwareAuthenticator,
  { origin, ip = nextIp() }: { origin?: string; ip?: string } = {},
) {
  const optionsResponse = await get("/passkey/generate-authenticate-options", { ip });
  expect(optionsResponse.status).toBe(200);
  const options = await optionsResponse.json();
  return post(
    "/passkey/verify-authentication",
    { response: authenticator.authenticate(options, { origin }) },
    { cookie: withCookies(optionsResponse), ip },
  );
}

async function userId(email: string): Promise<string> {
  const [user] = await testDb.select().from(authUsers).where(eq(authUsers.email, email));
  return user.id;
}

let auth: Auth;

beforeEach(async () => {
  auth = createAuth(testDb, resolveAuthEnv(ENV));
  await upsertOwner(testDb, { email: OWNER, password: PASSWORD });
});

describe("passkey registration", () => {
  test("requires a session", async () => {
    expect((await get("/passkey/generate-register-options")).status).toBe(401);
    expect((await post("/passkey/verify-registration", { response: {} })).status).toBe(401);
    expect(await testDb.$count(authPasskeys)).toBe(0);
  });

  test("the signed-in owner registers a passkey bound to the configured relying party", async () => {
    const session = await signInWithPassword();
    const authenticator = new SoftwareAuthenticator(RP_ID, BASE_URL);

    const { options, response } = await registerPasskey(authenticator, session, "MacBook");

    expect(options.rp).toEqual({ id: RP_ID, name: "brahua-os" });
    // Discoverable credential: sign-in starts without an email.
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required" });
    expect(response.status).toBe(200);
    const [passkey] = await testDb.select().from(authPasskeys);
    expect(passkey).toMatchObject({
      name: "MacBook",
      userId: await userId(OWNER),
      credentialID: authenticator.id,
      transports: "internal",
    });
    expect(passkey.createdAt).toBeInstanceOf(Date);
  });

  test("needs a fresh session: one older than a day must sign in with the password again", async () => {
    const session = await signInWithPassword();
    await testDb.update(authSessions).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) });

    const response = await get("/passkey/generate-register-options", { cookie: session });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
  });

  test("a response made for another origin is rejected", async () => {
    const session = await signInWithPassword();
    const authenticator = new SoftwareAuthenticator(RP_ID, "https://evil.example");

    const { response } = await registerPasskey(authenticator, session);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await testDb.$count(authPasskeys)).toBe(0);
  });
});

describe("passkey sign-in", () => {
  test("the owner signs in with a registered passkey and gets a 30-day session", async () => {
    const authenticator = new SoftwareAuthenticator(RP_ID, BASE_URL);
    await registerPasskey(authenticator, await signInWithPassword());
    await testDb.delete(authSessions);

    const response = await signInWithPasskey(authenticator);

    expect(response.status).toBe(200);
    expect(hasSessionCookie(response)).toBe(true);
    const cookie = withCookies(response);
    const session = await verifyOwnerSession(auth, new Headers({ cookie }), OWNER);
    expect(session?.user.email).toBe(OWNER);
    const maxAge = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("better-auth.session_token="))
      ?.match(/Max-Age=(\d+)/i)?.[1];
    expect(Number(maxAge)).toBe(30 * 24 * 60 * 60);
  });

  test("the challenge is bound to the rpID: options name localhost", async () => {
    const response = await get("/passkey/generate-authenticate-options");
    expect(await response.json()).toMatchObject({ rpId: RP_ID });
  });

  test("a passkey that belongs to another user never gets a session (database hook)", async () => {
    // Sign-up is disabled, so the only way to have such a passkey is a row planted in the DB,
    // e.g. left over after OWNER_EMAIL changed. It verifies, but the session hook refuses it.
    await upsertOwner(testDb, { email: OTHER, password: PASSWORD });
    const authenticator = new SoftwareAuthenticator(RP_ID, BASE_URL);
    await testDb.insert(authPasskeys).values(authenticator.passkeyRow(await userId(OTHER)));

    const response = await signInWithPasskey(authenticator);

    expect(response.status).not.toBe(200);
    expect(await response.json()).toMatchObject({ code: "UNABLE_TO_CREATE_SESSION" });
    expect(hasSessionCookie(response)).toBe(false);
    expect(await testDb.$count(authSessions)).toBe(0);
  });

  test("an unknown passkey is rejected without a session", async () => {
    const response = await signInWithPasskey(new SoftwareAuthenticator(RP_ID, BASE_URL));
    expect(response.status).toBe(401);
    expect(hasSessionCookie(response)).toBe(false);
    expect(await testDb.$count(authSessions)).toBe(0);
  });

  test("an assertion made on another origin is rejected", async () => {
    const authenticator = new SoftwareAuthenticator(RP_ID, BASE_URL);
    await registerPasskey(authenticator, await signInWithPassword());
    await testDb.delete(authSessions);

    const response = await signInWithPasskey(authenticator, { origin: "https://evil.example" });
    expect(response.status).toBe(400);
    expect(await testDb.$count(authSessions)).toBe(0);
  });

  test("a challenge works once: replaying the same assertion fails", async () => {
    const authenticator = new SoftwareAuthenticator(RP_ID, BASE_URL);
    await registerPasskey(authenticator, await signInWithPassword());
    await testDb.delete(authSessions);

    const ip = nextIp();
    const optionsResponse = await get("/passkey/generate-authenticate-options", { ip });
    const options = await optionsResponse.json();
    const body = { response: authenticator.authenticate(options) };
    const cookie = withCookies(optionsResponse);

    expect((await post("/passkey/verify-authentication", body, { cookie, ip })).status).toBe(200);
    const replay = await post("/passkey/verify-authentication", body, { cookie, ip });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
  });
});

describe("listPasskeys (home page list)", () => {
  test("returns only that user's passkeys, oldest first, without key material", async () => {
    await upsertOwner(testDb, { email: OTHER, password: PASSWORD });
    const session = await signInWithPassword();
    await registerPasskey(new SoftwareAuthenticator(RP_ID, BASE_URL), session, "MacBook");
    await registerPasskey(new SoftwareAuthenticator(RP_ID, BASE_URL), session);
    const foreign = new SoftwareAuthenticator(RP_ID, BASE_URL);
    await testDb.insert(authPasskeys).values(foreign.passkeyRow(await userId(OTHER)));

    const passkeys = await listPasskeys(testDb, await userId(OWNER));

    expect(passkeys.map((passkey) => passkey.label)).toEqual(["MacBook", "Passkey sin nombre"]);
    expect(Object.keys(passkeys[0]).sort()).toEqual(["createdAt", "createdLabel", "id", "label"]);
  });
});

describe("passkey rate limits", () => {
  test("the 6th passkey sign-in attempt within 60 s from one IP gets a 429", async () => {
    expect(PASSKEY_RATE_LIMITS["/passkey/verify-authentication"]).toEqual({ window: 60, max: 5 });
    const ip = nextIp();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await post("/passkey/verify-authentication", { response: {} }, { ip });
      expect(response.status).toBe(400);
    }
    const blocked = await post("/passkey/verify-authentication", { response: {} }, { ip });
    expect(blocked.status).toBe(429);
    // Other clients are not affected.
    const other = await post("/passkey/verify-authentication", { response: {} });
    expect(other.status).toBe(400);
  });

  test("sign-in options are capped at 10 per minute per IP", async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i++) {
      expect((await get("/passkey/generate-authenticate-options", { ip })).status).toBe(200);
    }
    expect((await get("/passkey/generate-authenticate-options", { ip })).status).toBe(429);
  });

  test("registration endpoints are capped as well", async () => {
    expect(PASSKEY_RATE_LIMITS["/passkey/generate-register-options"]).toEqual({
      window: 60,
      max: 10,
    });
    const ip = nextIp();
    for (let i = 0; i < 10; i++) {
      expect((await get("/passkey/generate-register-options", { ip })).status).toBe(401);
    }
    expect((await get("/passkey/generate-register-options", { ip })).status).toBe(429);
  });
});
