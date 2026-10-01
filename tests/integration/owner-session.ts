// Owner sessions for testing Server Actions: signs in through Better Auth's real handler against
// the test database and returns the session cookie.
import { expect } from "vitest";
import { createAuth } from "@/lib/auth";
import { resolveAuthEnv } from "@/lib/auth-env";
import { upsertOwner } from "@/modules/core/owner";
import { testDb } from "./test-db";

export const BASE_URL = "http://localhost:3417";
export const OWNER = "owner@example.com";
export const OTHER = "someone@example.com";
const PASSWORD = "correct horse battery";

/** Auth variables the actions read from process.env (set them in beforeAll). */
export const AUTH_ENV = {
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: BASE_URL,
  OWNER_EMAIL: OWNER,
};

let ipCounter = 0;

/** Signs in through Better Auth's handler and returns the session cookie for `email`. */
export async function sessionCookieFor(email: string, ownerEmail = email): Promise<string> {
  await upsertOwner(testDb, { email, password: PASSWORD });
  const auth = createAuth(testDb, resolveAuthEnv({ ...AUTH_ENV, OWNER_EMAIL: ownerEmail }));
  const response = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        // A different IP per sign-in, so the rate limit never kicks in.
        "x-forwarded-for": `198.51.100.${++ipCounter % 250}`,
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("better-auth.session_token="));
  if (!cookie) throw new Error("No session cookie");
  return cookie.split(";")[0];
}
