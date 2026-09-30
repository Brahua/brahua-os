import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resolveAuthEnv } from "@/lib/auth-env";
import {
  createAuth,
  getOwnerSession,
  requireOwner,
  SESSION_EXPIRES_IN,
  verifyOwnerSession,
  type Auth,
} from "@/lib/auth";
import { authAccounts, authSessions, authUsers } from "@/modules/core/db/auth-schema";
import { upsertOwner } from "@/modules/core/owner";
import { testDb } from "./test-db";

// requireOwner() reads the request headers and the app database: point both at the test.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const BASE_URL = "http://localhost:3417";
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
const nextIp = () => `203.0.113.${++ipCounter % 250}`;

function authFor(overrides: Record<string, string> = {}): Auth {
  return createAuth(testDb, resolveAuthEnv({ ...ENV, ...overrides }));
}

function post(auth: Auth, path: string, body: unknown, ip: string, base = BASE_URL) {
  return auth.handler(
    new Request(`${base}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base, "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

function signIn(auth: Auth, email: string, password: string, ip = nextIp()) {
  return post(auth, "/sign-in/email", { email, password }, ip);
}

/** `name=value` pair of the session token cookie, to send it back as a Cookie header. */
function sessionCookie(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.includes("better-auth.session_token="));
  if (!cookie) throw new Error("No session cookie in the response");
  return cookie.split(";")[0];
}

let auth: Auth;

beforeEach(async () => {
  auth = authFor();
  await upsertOwner(testDb, { email: OWNER, password: PASSWORD });
});

describe("sign-in", () => {
  test("the owner signs in and gets a 30-day, HttpOnly, SameSite=Lax session cookie", async () => {
    const response = await signIn(auth, OWNER, PASSWORD);
    expect(response.status).toBe(200);

    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("better-auth.session_token="));
    expect(cookie).toBeDefined();
    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie!)?.[1]);
    expect(maxAge).toBe(SESSION_EXPIRES_IN);
    expect(maxAge).toBe(30 * 24 * 60 * 60);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const [session] = await testDb.select().from(authSessions);
    const days = (session.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  test("over https the cookie is Secure and uses the __Secure- prefix", async () => {
    const secureAuth = authFor({ BETTER_AUTH_URL: "https://os.brahua.com" });
    const response = await post(
      secureAuth,
      "/sign-in/email",
      { email: OWNER, password: PASSWORD },
      nextIp(),
      "https://os.brahua.com",
    );
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Secure-better-auth.session_token="));
    expect(cookie).toMatch(/;\s*Secure/i);
  });

  test("a wrong password is rejected without a session", async () => {
    const response = await signIn(auth, OWNER, "not the password");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(await testDb.$count(authSessions)).toBe(0);
  });

  test("another email is rejected with the same error, even with valid credentials", async () => {
    await upsertOwner(testDb, { email: OTHER, password: PASSWORD });

    const response = await signIn(auth, OTHER, PASSWORD);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(await testDb.$count(authSessions)).toBe(0);
  });

  test("the owner email is matched without regard to case", async () => {
    const response = await signIn(auth, "Owner@Example.com", PASSWORD);
    expect(response.status).toBe(200);
  });
});

describe("sign-up", () => {
  test("is disabled", async () => {
    const response = await post(
      auth,
      "/sign-up/email",
      { email: OWNER.replace("owner", "new"), password: "a long enough password", name: "x" },
      nextIp(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });
    expect(await testDb.$count(authUsers)).toBe(1);
  });
});

describe("rate limit", () => {
  test("the 6th sign-in attempt within 60 s from one IP gets a 429", async () => {
    const ip = nextIp();
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await signIn(auth, OWNER, `wrong password ${attempt}`, ip)).status).toBe(401);
    }

    const blocked = await signIn(auth, OWNER, PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("X-Retry-After"))).toBeGreaterThan(0);
    expect(Number(blocked.headers.get("X-Retry-After"))).toBeLessThanOrEqual(60);

    // Stored in the database (not memory): a new instance, like another serverless function,
    // still sees the counter.
    expect((await signIn(authFor(), OWNER, PASSWORD, ip)).status).toBe(429);
    // Other clients are not affected.
    expect((await signIn(auth, OWNER, PASSWORD, nextIp())).status).toBe(200);
  });
});

describe("owner session", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, ENV);
    request.headers = new Headers();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function expectRedirectToLogin(promise: Promise<unknown>) {
    await expect(promise).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  }

  test("requireOwner redirects to /login without a session", async () => {
    await expectRedirectToLogin(requireOwner());
    expect(await getOwnerSession()).toBeNull();
  });

  test("requireOwner redirects with an unknown or tampered session cookie", async () => {
    request.headers = new Headers({ cookie: "better-auth.session_token=forged.signature" });
    await expectRedirectToLogin(requireOwner());
  });

  test("requireOwner returns the session of the owner", async () => {
    const response = await signIn(auth, OWNER, PASSWORD);
    request.headers = new Headers({ cookie: sessionCookie(response) });

    const session = await requireOwner();
    expect(session.user.email).toBe(OWNER);
  });

  test("a valid session whose email is not OWNER_EMAIL is rejected", async () => {
    // A session created while another address was the owner (e.g. OWNER_EMAIL changed).
    await upsertOwner(testDb, { email: OTHER, password: PASSWORD });
    const response = await signIn(authFor({ OWNER_EMAIL: OTHER }), OTHER, PASSWORD);
    expect(response.status).toBe(200);
    const cookie = sessionCookie(response);

    expect(await verifyOwnerSession(auth, new Headers({ cookie }), OTHER)).not.toBeNull();
    request.headers = new Headers({ cookie });
    await expectRedirectToLogin(requireOwner());
  });

  test("signing out ends the session", async () => {
    const cookie = sessionCookie(await signIn(auth, OWNER, PASSWORD));
    const out = await auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: { cookie, origin: BASE_URL, "x-forwarded-for": nextIp() },
      }),
    );
    expect(out.status).toBe(200);
    expect(await verifyOwnerSession(auth, new Headers({ cookie }), OWNER)).toBeNull();
  });
});

describe("pnpm auth:owner (upsertOwner)", () => {
  test("creates a verified owner with one credential account", async () => {
    const [user] = await testDb.select().from(authUsers);
    expect(user).toMatchObject({ email: OWNER, emailVerified: true });
    const accounts = await testDb.select().from(authAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ providerId: "credential", accountId: user.id });
    expect(accounts[0].password).not.toContain(PASSWORD);
  });

  test("resetting replaces the password, signs out every session and never duplicates", async () => {
    await signIn(auth, OWNER, PASSWORD);
    expect(await testDb.$count(authSessions)).toBe(1);

    const result = await upsertOwner(testDb, {
      email: " OWNER@example.com",
      password: "a brand new password",
    });
    expect(result).toEqual({ created: false, revokedSessions: 1 });
    expect(await testDb.$count(authUsers)).toBe(1);
    expect(await testDb.$count(authAccounts)).toBe(1);
    expect(await testDb.$count(authSessions)).toBe(0);

    expect((await signIn(auth, OWNER, PASSWORD)).status).toBe(401);
    expect((await signIn(auth, OWNER, "a brand new password")).status).toBe(200);
  });

  test("deleting the owner cascades to accounts and sessions", async () => {
    await signIn(auth, OWNER, PASSWORD);
    await testDb.delete(authUsers).where(eq(authUsers.email, OWNER));
    expect(await testDb.$count(authAccounts)).toBe(0);
    expect(await testDb.$count(authSessions)).toBe(0);
  });
});
