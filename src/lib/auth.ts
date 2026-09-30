// Better Auth configuration (SPEC-core: "Autenticación y seguridad") and the owner guard.
// Single user: only OWNER_EMAIL can sign in; sign-up is disabled and the owner is created
// with `pnpm auth:owner`.
import { waitUntil } from "@vercel/functions";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
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

export const LOGIN_PATH = "/login";

/** Same error Better Auth returns for a wrong password, so other emails reveal nothing. */
function invalidCredentials() {
  return new APIError("UNAUTHORIZED", {
    code: "INVALID_EMAIL_OR_PASSWORD",
    message: "Invalid email or password",
  });
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
      customRules: { "/sign-in/email": { ...SIGN_IN_RATE_LIMIT } },
    },
    advanced: {
      useSecureCookies: env.secureCookies,
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
      // Rate-limit pruning and similar work finish after the response on Vercel Functions.
      backgroundTasks: { handler: waitUntil },
    },
    telemetry: { enabled: false },
    hooks: {
      // Rejects any email other than the owner with the generic credentials error. The password
      // is still hashed so the response takes as long as a wrong password for the owner.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const body = (ctx.body ?? {}) as { email?: unknown; password?: unknown };
        if (typeof body.email === "string" && isOwnerEmail(body.email, env.ownerEmail)) return;
        await ctx.context.password.hash(typeof body.password === "string" ? body.password : "");
        throw invalidCredentials();
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // Backstop for every sign-in method (the passkey plugin arrives in C2b):
          // no session is ever created for anyone but the owner.
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
    // nextCookies must stay the last plugin (lets Server Actions set auth cookies).
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type OwnerSession = Auth["$Infer"]["Session"];

let cachedAuth: Auth | undefined;

/**
 * Lazy Better Auth instance over the app database. Created on first use so `next build` never
 * needs secrets; a missing or invalid variable throws a clear error on the first request.
 */
export function getAuth(): Auth {
  cachedAuth ??= createAuth(getDb(), resolveAuthEnv(process.env));
  return cachedAuth;
}

/** Validates the session in the request headers and that it belongs to the owner. */
export async function verifyOwnerSession(
  auth: Auth,
  requestHeaders: Headers,
  ownerEmail: string,
): Promise<OwnerSession | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session || !isOwnerEmail(session.user.email, ownerEmail)) return null;
  return session;
}

/** Owner session for the current request, or null. Memoized per render pass. */
export const getOwnerSession = cache(async (): Promise<OwnerSession | null> => {
  // Reading the request first makes every caller dynamic, so `next build` never evaluates
  // the auth configuration while prerendering.
  const requestHeaders = await headers();
  const ownerEmail = resolveAuthEnv(process.env).ownerEmail;
  return verifyOwnerSession(getAuth(), requestHeaders, ownerEmail);
});

/**
 * Guard for pages, layouts and queries: returns the owner session or redirects to /login.
 * SPEC-core: call it in the `(app)` layout and in every page, action and query, never only in
 * a proxy. Server Actions will get a variant that returns an authorization error (C5).
 */
export async function requireOwner(): Promise<OwnerSession> {
  const session = await getOwnerSession();
  if (!session) redirect(LOGIN_PATH);
  return session;
}
