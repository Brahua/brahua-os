// Passkey sign-in and registration through the real Better Auth handler, with a software
// authenticator standing in for the browser (the E2E uses Chromium's virtual authenticator).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import {
  createAuth,
  PASSKEY_RATE_LIMITS,
  RECENT_SESSION_MAX_AGE,
  verifyOwnerSession,
  type Auth,
} from "@/lib/auth";
import { PASSKEY_NAME_MAX_LENGTH, resolveAuthEnv } from "@/lib/auth-env";
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

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ code });
}

async function signInWithPassword(): Promise<string> {
  const response = await post("/sign-in/email", { email: OWNER, password: PASSWORD });
  expect(response.status).toBe(200);
  return withCookies(response);
}

/** Makes every session look like it was created `seconds` ago. */
async function ageSessions(seconds: number) {
  await testDb.update(authSessions).set({ createdAt: new Date(Date.now() - seconds * 1000) });
}

/** Registration options for the signed-in owner, plus the cookie with the challenge. */
async function registrationOptions(session: string) {
  const optionsResponse = await get("/passkey/generate-register-options", { cookie: session });
  expect(optionsResponse.status).toBe(200);
  return { options: await optionsResponse.json(), cookie: withCookies(optionsResponse, session) };
}

/** Full registration ceremony for the signed-in owner. */
async function registerPasskey(
  authenticator: SoftwareAuthenticator,
  session: string,
  { name, userVerified }: { name?: string; userVerified?: boolean } = {},
) {
  const { options, cookie } = await registrationOptions(session);
  return {
    options,
    response: await post(
      "/passkey/verify-registration",
      { response: authenticator.register(options, { userVerified }), name },
      { cookie },
    ),
  };
}

/** Full sign-in ceremony, signed out. `origin` lets a test forge where the browser was. */
async function signInWithPasskey(
  authenticator: SoftwareAuthenticator,
  {
    origin,
    userVerified,
    rpID,
    ip = nextIp(),
  }: { origin?: string; userVerified?: boolean; rpID?: string; ip?: string } = {},
) {
  const optionsResponse = await get("/passkey/generate-authenticate-options", { ip });
  expect(optionsResponse.status).toBe(200);
  const options = await optionsResponse.json();
  return post(
    "/passkey/verify-authentication",
    { response: authenticator.authenticate(options, { origin, userVerified, rpID }) },
    { cookie: withCookies(optionsResponse), ip },
  );
}

/** Registers a passkey for the owner, then signs out everywhere. */
async function ownerWithPasskey(authenticator = new SoftwareAuthenticator(RP_ID, BASE_URL)) {
  const { response } = await registerPasskey(authenticator, await signInWithPassword());
  expect(response.status).toBe(200);
  await testDb.delete(authSessions);
  return authenticator;
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

    const { options, response } = await registerPasskey(authenticator, session, {
      name: "MacBook",
    });

    expect(options.rp).toEqual({ id: RP_ID, name: "brahua-os" });
    // Discoverable and user-verified: the passkey is the only factor.
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });
    // The keychain entry is named after the owner, never after the label.
    expect(options.user.name).toBe(OWNER);
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

  test("a passkey without user verification (presence only) is refused", async () => {
    const session = await signInWithPassword();
    const { response } = await registerPasskey(
      new SoftwareAuthenticator(RP_ID, BASE_URL),
      session,
      { userVerified: false },
    );
    await expectError(response, 400, "FAILED_TO_VERIFY_REGISTRATION");
    expect(await testDb.$count(authPasskeys)).toBe(0);
  });

  test("a response made for another origin is refused", async () => {
    const session = await signInWithPassword();
    const authenticator = new SoftwareAuthenticator(RP_ID, "https://evil.example");

    const { response } = await registerPasskey(authenticator, session);
    // The plugin reports a failed WebAuthn check during registration as a 500.
    await expectError(response, 500, "FAILED_TO_VERIFY_REGISTRATION");
    expect(await testDb.$count(authPasskeys)).toBe(0);
  });

  test("a response signed for another rpID is refused", async () => {
    const session = await signInWithPassword();
    const authenticator = new SoftwareAuthenticator("evil.example", BASE_URL);

    const { response } = await registerPasskey(authenticator, session);
    await expectError(response, 500, "FAILED_TO_VERIFY_REGISTRATION");
    expect(await testDb.$count(authPasskeys)).toBe(0);
  });

  test("labels longer than the limit are refused by the server", async () => {
    const session = await signInWithPassword();
    const { response } = await registerPasskey(
      new SoftwareAuthenticator(RP_ID, BASE_URL),
      session,
      { name: "x".repeat(PASSKEY_NAME_MAX_LENGTH + 1) },
    );
    await expectError(response, 400, "PASSKEY_NAME_TOO_LONG");
    expect(await testDb.$count(authPasskeys)).toBe(0);
  });
});

describe("recent sign-in required to change passkeys", () => {
  const STALE = RECENT_SESSION_MAX_AGE + 60;

  test("the limit is 10 minutes", () => {
    expect(RECENT_SESSION_MAX_AGE).toBe(10 * 60);
  });

  test("a session a few minutes old can still register", async () => {
    const session = await signInWithPassword();
    await ageSessions(RECENT_SESSION_MAX_AGE - 60);
    const { response } = await registerPasskey(new SoftwareAuthenticator(RP_ID, BASE_URL), session);
    expect(response.status).toBe(200);
  });

  test("generate-register-options needs a session younger than 10 minutes", async () => {
    const session = await signInWithPassword();
    await ageSessions(STALE);
    await expectError(
      await get("/passkey/generate-register-options", { cookie: session }),
      403,
      "SESSION_NOT_FRESH",
    );
  });

  test("verify-registration re-checks it: options fetched in time are not enough", async () => {
    const session = await signInWithPassword();
    const { options, cookie } = await registrationOptions(session);
    await ageSessions(STALE);

    const authenticator = new SoftwareAuthenticator(RP_ID, BASE_URL);
    const response = await post(
      "/passkey/verify-registration",
      { response: authenticator.register(options) },
      { cookie },
    );
    await expectError(response, 403, "SESSION_NOT_FRESH");
    expect(await testDb.$count(authPasskeys)).toBe(0);
  });

  test("renaming and deleting need it too", async () => {
    const session = await signInWithPassword();
    await registerPasskey(new SoftwareAuthenticator(RP_ID, BASE_URL), session);
    const [passkey] = await testDb.select().from(authPasskeys);
    await ageSessions(STALE);

    await expectError(
      await post(
        "/passkey/update-passkey",
        { id: passkey.id, name: "iPhone" },
        { cookie: session },
      ),
      403,
      "SESSION_NOT_FRESH",
    );
    await expectError(
      await post("/passkey/delete-passkey", { id: passkey.id }, { cookie: session }),
      403,
      "SESSION_NOT_FRESH",
    );
    expect(await testDb.$count(authPasskeys)).toBe(1);
  });

  test("with a recent session the owner renames (capped) and deletes a passkey", async () => {
    const session = await signInWithPassword();
    await registerPasskey(new SoftwareAuthenticator(RP_ID, BASE_URL), session);
    const [passkey] = await testDb.select().from(authPasskeys);

    await expectError(
      await post(
        "/passkey/update-passkey",
        { id: passkey.id, name: "x".repeat(PASSKEY_NAME_MAX_LENGTH + 1) },
        { cookie: session },
      ),
      400,
      "PASSKEY_NAME_TOO_LONG",
    );
    const renamed = await post(
      "/passkey/update-passkey",
      { id: passkey.id, name: "iPhone" },
      { cookie: session },
    );
    expect(renamed.status).toBe(200);
    const [row] = await testDb.select().from(authPasskeys);
    expect(row.name).toBe("iPhone");

    const deleted = await post("/passkey/delete-passkey", { id: passkey.id }, { cookie: session });
    expect(deleted.status).toBe(200);
    expect(await testDb.$count(authPasskeys)).toBe(0);
  });
});

describe("passkey sign-in", () => {
  test("the owner signs in with a registered passkey and gets a 30-day session", async () => {
    const authenticator = await ownerWithPasskey();

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

  // The plugin always sends userVerification "preferred" here; the client asks for "required"
  // and the afterVerification hook enforces it (next test).
  test("options are bound to the rpID", async () => {
    const response = await get("/passkey/generate-authenticate-options");
    expect(await response.json()).toMatchObject({ rpId: RP_ID });
  });

  test("an assertion without user verification (presence only) is refused", async () => {
    const authenticator = await ownerWithPasskey();

    const response = await signInWithPasskey(authenticator, { userVerified: false });

    await expectError(response, 401, "AUTHENTICATION_FAILED");
    expect(hasSessionCookie(response)).toBe(false);
    expect(await testDb.$count(authSessions)).toBe(0);
  });

  test("a passkey that belongs to another user never gets a session (database hook)", async () => {
    // Sign-up is disabled, so the only way to have such a passkey is a row planted in the DB,
    // e.g. left over after OWNER_EMAIL changed. It verifies, but the session hook refuses it.
    await upsertOwner(testDb, { email: OTHER, password: PASSWORD });
    const authenticator = new SoftwareAuthenticator(RP_ID, BASE_URL);
    await testDb.insert(authPasskeys).values(authenticator.passkeyRow(await userId(OTHER)));

    const response = await signInWithPasskey(authenticator);

    await expectError(response, 500, "UNABLE_TO_CREATE_SESSION");
    expect(hasSessionCookie(response)).toBe(false);
    expect(await testDb.$count(authSessions)).toBe(0);
  });

  test("an unknown passkey is rejected without a session", async () => {
    const response = await signInWithPasskey(new SoftwareAuthenticator(RP_ID, BASE_URL));
    await expectError(response, 401, "PASSKEY_NOT_FOUND");
    expect(hasSessionCookie(response)).toBe(false);
    expect(await testDb.$count(authSessions)).toBe(0);
  });

  test("an assertion made on another origin is rejected", async () => {
    const authenticator = await ownerWithPasskey();

    const response = await signInWithPasskey(authenticator, { origin: "https://evil.example" });
    await expectError(response, 400, "AUTHENTICATION_FAILED");
    expect(await testDb.$count(authSessions)).toBe(0);
  });

  test("an assertion signed for another rpID is rejected", async () => {
    const authenticator = await ownerWithPasskey();

    // Same key and credential id, but the authenticator data names another relying party.
    const response = await signInWithPasskey(authenticator, { rpID: "evil.example" });
    await expectError(response, 400, "AUTHENTICATION_FAILED");
    expect(await testDb.$count(authSessions)).toBe(0);
  });

  test("a challenge works once: replaying the same assertion fails", async () => {
    const authenticator = await ownerWithPasskey();

    const ip = nextIp();
    const optionsResponse = await get("/passkey/generate-authenticate-options", { ip });
    const options = await optionsResponse.json();
    const body = { response: authenticator.authenticate(options) };
    const cookie = withCookies(optionsResponse);

    expect((await post("/passkey/verify-authentication", body, { cookie, ip })).status).toBe(200);
    const replay = await post("/passkey/verify-authentication", body, { cookie, ip });
    await expectError(replay, 400, "CHALLENGE_NOT_FOUND");
  });
});

describe("recovery (pnpm auth:owner)", () => {
  test("resetting the password removes every passkey, which then stops working", async () => {
    const authenticator = await ownerWithPasskey();
    expect(await testDb.$count(authPasskeys)).toBe(1);

    const result = await upsertOwner(testDb, { email: OWNER, password: "a brand new password" });

    expect(result).toEqual({ created: false, revokedSessions: 0, revokedPasskeys: 1 });
    expect(await testDb.$count(authPasskeys)).toBe(0);
    await expectError(await signInWithPasskey(authenticator), 401, "PASSKEY_NOT_FOUND");
  });

  test("other users' passkeys are left alone", async () => {
    await upsertOwner(testDb, { email: OTHER, password: PASSWORD });
    const other = new SoftwareAuthenticator(RP_ID, BASE_URL);
    await testDb.insert(authPasskeys).values(other.passkeyRow(await userId(OTHER)));

    const result = await upsertOwner(testDb, { email: OWNER, password: PASSWORD });
    expect(result.revokedPasskeys).toBe(0);
    expect(await testDb.$count(authPasskeys)).toBe(1);
  });
});

describe("listPasskeys (home page list)", () => {
  test("returns only that user's passkeys, oldest first, without key material", async () => {
    await upsertOwner(testDb, { email: OTHER, password: PASSWORD });
    const session = await signInWithPassword();
    await registerPasskey(new SoftwareAuthenticator(RP_ID, BASE_URL), session, {
      name: "MacBook",
    });
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
