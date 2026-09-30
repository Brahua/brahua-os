// Better Auth configuration (SPEC-core: "Autenticación y seguridad") and the owner guard.
// Single user: only OWNER_EMAIL can sign in; sign-up is disabled and the owner is created
// with `pnpm auth:owner`.
import { passkey, PASSKEY_ERROR_CODES } from "@better-auth/passkey";
import { waitUntil } from "@vercel/functions";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authSchema, authUsers } from "@/modules/core/db/auth-schema";
import {
  isOwnerEmail,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSKEY_NAME_MAX_LENGTH,
  resolveAuthEnv,
  type AuthEnv,
} from "./auth-env";
import { getDb, type Database } from "./db";

const DAY = 60 * 60 * 24;
/** SPEC-core: the session lasts 30 days and is extended once a day while in use. */
export const SESSION_EXPIRES_IN = 30 * DAY;
export const SESSION_UPDATE_AGE = DAY;
/** SPEC-core: the 6th sign-in attempt within 60 s from the same IP gets a 429. */
export const SIGN_IN_RATE_LIMIT = { window: 60, max: 5 } as const;
/**
 * Passkey endpoints (the plugin declares no limits, so they would get the global 100 per 10 s).
 * Signing in with a passkey counts like a password attempt. The two options endpoints each
 * write a challenge row (the login page asks for one per load, for autofill, and one per button
 * press) and verify-registration writes a passkey, so all three are capped too.
 */
export const PASSKEY_RATE_LIMITS = {
  "/passkey/verify-authentication": SIGN_IN_RATE_LIMIT,
  "/passkey/generate-authenticate-options": { window: 60, max: 10 },
  "/passkey/generate-register-options": { window: 60, max: 10 },
  "/passkey/verify-registration": { window: 60, max: 10 },
} as const;

/**
 * Changing the passkeys needs a recent sign-in, not just a valid session: someone with the
 * owner's unlocked device should not be able to add their own passkey (a way back in) or remove
 * the owner's. Stricter than Better Auth's `freshAge` (1 day), which the plugin also applies.
 */
export const RECENT_SESSION_MAX_AGE = 10 * 60;
export const RECENT_SESSION_PATHS: ReadonlySet<string> = new Set([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/delete-passkey",
  "/passkey/update-passkey",
]);

/** Same code and status Better Auth uses when a session is too old for a sensitive action. */
function sessionNotFresh() {
  return new APIError("FORBIDDEN", {
    code: "SESSION_NOT_FRESH",
    message: "Sign in again with your password to change your passkeys",
  });
}

function passkeyNameTooLong() {
  return new APIError("BAD_REQUEST", {
    code: "PASSKEY_NAME_TOO_LONG",
    message: `Passkey names are at most ${PASSKEY_NAME_MAX_LENGTH} characters`,
  });
}

export const LOGIN_PATH = "/login";

/** Same error Better Auth returns for a wrong password, so other emails reveal nothing. */
function invalidCredentials() {
  return new APIError("UNAUTHORIZED", {
    code: "INVALID_EMAIL_OR_PASSWORD",
    message: "Invalid email or password",
  });
}

/** A sign-in request that Better Auth may process: the owner's exact email and a sane password. */
export function isAcceptableOwnerSignIn(
  email: unknown,
  password: unknown,
  ownerEmail: string,
): boolean {
  return (
    typeof email === "string" &&
    email === email.trim() &&
    isOwnerEmail(email, ownerEmail) &&
    typeof password === "string" &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

export function createAuth(db: Database, env: AuthEnv) {
  return betterAuth({
    appName: "brahua-os",
    baseURL: env.baseURL,
    secret: env.secret,
    trustedOrigins: env.trustedOrigins,
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    user: { modelName: "auth_users" },
    session: {
      modelName: "auth_sessions",
      expiresIn: SESSION_EXPIRES_IN,
      updateAge: SESSION_UPDATE_AGE,
    },
    account: { modelName: "auth_accounts", accountLinking: { enabled: false } },
    verification: { modelName: "auth_verifications" },
    rateLimit: {
      // Explicit: Better Auth only enables it in production by default.
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limits",
      customRules: {
        "/sign-in/email": { ...SIGN_IN_RATE_LIMIT },
        ...PASSKEY_RATE_LIMITS,
        // Called on every app load to renew the cookie (SessionRefresher); a database write per
        // call would buy nothing: it needs a valid session and never checks credentials.
        "/get-session": false,
      },
    },
    advanced: {
      // The rate-limit key is the client IP. On Vercel, x-forwarded-for holds the real client IP:
      // Vercel overwrites it and does not forward external values, so it cannot be spoofed
      // (https://vercel.com/docs/headers/request-headers). Requests without a usable IP are not
      // exempt: Better Auth puts them all in one shared per-path bucket ("no-trusted-ip").
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      useSecureCookies: env.secureCookies,
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
      // Rate-limit pruning and similar work finish after the response on Vercel Functions.
      backgroundTasks: { handler: waitUntil },
    },
    telemetry: { enabled: false },
    hooks: {
      // Anything that is not "the exact owner email + a password of acceptable length" gets the
      // same 401 as a wrong password, so no response (not even Better Auth's own 400s for a
      // padded email or a too-long password) reveals which email is the owner's. The password
      // is still hashed (capped) so the response takes as long as a wrong owner password.
      before: createAuthMiddleware(async (ctx) => {
        if (RECENT_SESSION_PATHS.has(ctx.path)) {
          // No session: the endpoint itself answers 401.
          const session = await getSessionFromCtx(ctx, { disableRefresh: true });
          if (session) {
            const age = Date.now() - new Date(session.session.createdAt).getTime();
            // Negated so an invalid createdAt (NaN age) is treated as not fresh.
            if (!(age < RECENT_SESSION_MAX_AGE * 1000)) throw sessionNotFresh();
          }
          // The label is shown in the list; the plugin puts no limit on it and stores it
          // untrimmed, so the raw length is what counts.
          const name = (ctx.body as { name?: unknown } | undefined)?.name;
          if (typeof name === "string" && name.length > PASSKEY_NAME_MAX_LENGTH) {
            throw passkeyNameTooLong();
          }
          return;
        }
        if (ctx.path !== "/sign-in/email") return;
        const body = (ctx.body ?? {}) as { email?: unknown; password?: unknown };
        const password = typeof body.password === "string" ? body.password : "";
        if (isAcceptableOwnerSignIn(body.email, body.password, env.ownerEmail)) return;
        await ctx.context.password.hash(password.slice(0, MAX_PASSWORD_LENGTH));
        throw invalidCredentials();
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // Backstop for every sign-in method (password and passkey alike): no session is ever
          // created for anyone but the owner. A passkey of another user verifies, then fails here.
          before: async (session) => {
            const [user] = await db
              .select({ email: authUsers.email })
              .from(authUsers)
              .where(eq(authUsers.id, session.userId));
            if (!isOwnerEmail(user?.email, env.ownerEmail)) return false;
          },
        },
      },
    },
    plugins: [
      passkey({
        // Bound to the configured origin, never to the request (SPEC-core: rpID os.brahua.com).
        rpID: env.passkey.rpID,
        rpName: env.passkey.rpName,
        origin: env.passkey.origin,
        // Discoverable credentials: sign-in starts without an email, so the device must be able
        // to find the passkey on its own. The passkey is the only factor, so it must prove who
        // is holding the device (biometrics or device PIN), not just that someone is there.
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        // The plugin verifies with requireUserVerification: false; these hooks enforce it.
        registration: {
          // Registering needs a session (the default, explicit here). The before hook above
          // also requires it to be recent (RECENT_SESSION_MAX_AGE).
          requireSession: true,
          afterVerification: ({ verification }) => {
            if (!verification.registrationInfo?.userVerified) {
              throw APIError.from("BAD_REQUEST", PASSKEY_ERROR_CODES.FAILED_TO_VERIFY_REGISTRATION);
            }
          },
        },
        authentication: {
          afterVerification: ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) {
              throw APIError.from("UNAUTHORIZED", PASSKEY_ERROR_CODES.AUTHENTICATION_FAILED);
            }
          },
        },
        schema: { passkey: { modelName: "auth_passkeys" } },
      }),
      // nextCookies must stay the last plugin (lets Server Actions set auth cookies).
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type OwnerSession = Auth["$Infer"]["Session"];

let cachedEnv: AuthEnv | undefined;
let cachedAuth: Auth | undefined;

/** Validated auth settings, parsed once per instance. Throws a clear error if any is missing. */
export function getAuthEnv(): AuthEnv {
  cachedEnv ??= resolveAuthEnv(process.env);
  return cachedEnv;
}

/**
 * Lazy Better Auth instance over the app database. Created on first use so `next build` never
 * needs secrets; a missing or invalid variable throws a clear error on the first request.
 */
export function getAuth(): Auth {
  cachedAuth ??= createAuth(getDb(), getAuthEnv());
  return cachedAuth;
}

/**
 * Validates the session in the request headers and that it belongs to the owner.
 * Read-only: Server Components cannot set cookies, so refreshing here would move the expiry
 * in the database but not in the browser. The cookie is renewed through the HTTP handler
 * (`SessionRefresher` calls /api/auth/get-session from the browser).
 */
export async function verifyOwnerSession(
  auth: Auth,
  requestHeaders: Headers,
  ownerEmail: string,
): Promise<OwnerSession | null> {
  const session = await auth.api.getSession({
    headers: requestHeaders,
    query: { disableRefresh: true },
  });
  if (!session || !isOwnerEmail(session.user.email, ownerEmail)) return null;
  return session;
}

/** Owner session for the current request, or null. Memoized per render pass. */
export const getOwnerSession = cache(async (): Promise<OwnerSession | null> => {
  // Reading the request first makes every caller dynamic, so `next build` never evaluates
  // the auth configuration while prerendering.
  const requestHeaders = await headers();
  return verifyOwnerSession(getAuth(), requestHeaders, getAuthEnv().ownerEmail);
});

/**
 * Guard for pages, layouts and queries: returns the owner session or redirects to /login.
 * SPEC-core: call it in the `(app)` layout and in every page, action and query, never only in
 * a proxy. Server Actions use `requireOwnerAction()`, which returns an error instead.
 */
export async function requireOwner(): Promise<OwnerSession> {
  const session = await getOwnerSession();
  if (!session) redirect(LOGIN_PATH);
  return session;
}

/**
 * Guard for Server Actions: the owner session, or null. SPEC-core: in actions, a missing or
 * foreign session is an authorization error returned as an `ActionResult` (see `unauthorized()`
 * in @/lib/action-result), not a redirect, so the form can say what happened.
 */
export async function requireOwnerAction(): Promise<OwnerSession | null> {
  return getOwnerSession();
}
