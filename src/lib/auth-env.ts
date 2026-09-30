// Pure helpers for the auth configuration: no I/O, safe to unit test and to run in scripts.

type Env = Record<string, string | undefined>;

/** Production origin (SPEC-core: dominio `os.brahua.com`). */
export const PRODUCTION_ORIGIN = "https://os.brahua.com";
/** Origin of `pnpm dev`, trusted only outside production. */
export const DEV_ORIGIN = "http://localhost:3000";
export const MIN_SECRET_LENGTH = 32;
export const MIN_PASSWORD_LENGTH = 12;
/** Better Auth's default maximum; longer passwords are rejected before hashing. */
export const MAX_PASSWORD_LENGTH = 128;

// Better Auth's built-in fallback secret: never acceptable.
const PLACEHOLDER_SECRETS = new Set(["better-auth-secret-123456789"]);

export type AuthEnv = {
  secret: string;
  baseURL: string;
  ownerEmail: string;
  trustedOrigins: string[];
  /** `Secure` cookies (always on over HTTPS; forced in Vercel production). */
  secureCookies: boolean;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Loose shape check; Better Auth validates the email format again on sign-in. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Case- and whitespace-insensitive comparison against the configured owner. */
export function isOwnerEmail(email: string | null | undefined, ownerEmail: string): boolean {
  if (!email) return false;
  return normalizeEmail(email) === normalizeEmail(ownerEmail);
}

/** True in the Vercel production environment (the only deployed environment during the MVP). */
export function isVercelProduction(env: Env): boolean {
  return env.VERCEL_ENV === "production";
}

/**
 * Reads and validates every auth setting at once. Throws one error naming every missing or
 * invalid variable (never their values), so a misconfigured deploy fails loudly instead of
 * falling back to an insecure default.
 */
export function resolveAuthEnv(env: Env): AuthEnv {
  const problems: string[] = [];
  const production = isVercelProduction(env);

  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (!secret) problems.push("BETTER_AUTH_SECRET is not set");
  else if (secret.length < MIN_SECRET_LENGTH || PLACEHOLDER_SECRETS.has(secret)) {
    problems.push(
      `BETTER_AUTH_SECRET must be a random value of at least ${MIN_SECRET_LENGTH} characters`,
    );
  }

  const ownerEmail = normalizeEmail(env.OWNER_EMAIL ?? "");
  if (!ownerEmail) problems.push("OWNER_EMAIL is not set");
  else if (!isEmail(ownerEmail)) problems.push("OWNER_EMAIL is not a valid email address");

  let baseURL = "";
  const rawURL = env.BETTER_AUTH_URL ?? "";
  if (!rawURL) problems.push("BETTER_AUTH_URL is not set");
  else {
    try {
      const url = new URL(rawURL);
      baseURL = url.origin;
      if (production && url.protocol !== "https:") {
        problems.push("BETTER_AUTH_URL must use https in production");
      }
    } catch {
      problems.push("BETTER_AUTH_URL is not a valid URL");
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid auth configuration:\n- ${problems.join("\n- ")}`);
  }

  const trustedOrigins = new Set([baseURL]);
  if (production) trustedOrigins.add(PRODUCTION_ORIGIN);
  // SPEC-core: the current preview origin. There are no previews during the MVP.
  if (env.VERCEL_ENV === "preview" && env.VERCEL_BRANCH_URL) {
    trustedOrigins.add(`https://${env.VERCEL_BRANCH_URL}`);
  }
  if (env.NODE_ENV !== "production") trustedOrigins.add(DEV_ORIGIN);

  return {
    secret,
    baseURL,
    ownerEmail,
    trustedOrigins: [...trustedOrigins],
    secureCookies: production || baseURL.startsWith("https://"),
  };
}

export type PasswordCheck = { ok: true } | { ok: false; error: string };

/** Owner password rules (SPEC-core: mínimo 12 caracteres). Messages are shown in the terminal. */
export function checkOwnerPassword(password: string, confirmation: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `La contraseña no puede superar ${MAX_PASSWORD_LENGTH} caracteres.`,
    };
  }
  if (password.trim() !== password) {
    return { ok: false, error: "La contraseña no puede empezar ni terminar con espacios." };
  }
  if (password !== confirmation) {
    return { ok: false, error: "Las contraseñas no coinciden." };
  }
  return { ok: true };
}
