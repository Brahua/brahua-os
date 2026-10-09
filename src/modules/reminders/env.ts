// Environment of `reminders` (SPEC-reminders "Comandos y estructura"): validated here, in one place,
// so a missing or malformed variable gives a clear message that names the VARIABLE, never its
// value. Values are secrets (the owner sets them in their own terminal): they are never printed,
// logged or returned to the client.
import { createHash, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

export const DEFAULT_TELEGRAM_API_BASE = "https://api.telegram.org";

/** Telegram's own rule for `secret_token`: 1–256 characters of A-Z a-z 0-9 _ -. We ask for 16+. */
const WEBHOOK_SECRET = /^[A-Za-z0-9_-]{16,256}$/;
/** `123456:ABC-def_…`: digits, a colon and url-safe characters (it goes in the URL path). */
const BOT_TOKEN = /^[A-Za-z0-9:_-]{8,200}$/;
const BOT_USERNAME = /^[A-Za-z0-9_]{5,32}$/;

export type TelegramEnv = {
  token: string;
  webhookSecret: string;
  /** Without the leading "@". */
  botUsername: string;
  /** Telegram's API base (`TELEGRAM_API_BASE`): the official one, or a fake server in tests. */
  apiBase: string;
  /** Public origin of the app (`BETTER_AUTH_URL`): where Telegram's webhook points. */
  appOrigin: string;
};

export type TelegramEnvResult =
  | { ok: true; value: TelegramEnv }
  /** `problems` are variable names (and what is wrong), never values. */
  | { ok: false; problems: string[] };

function parseHttpUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Reads and validates what the Telegram channel needs. */
export function resolveTelegramEnv(env: Env = process.env): TelegramEnvResult {
  const problems: string[] = [];
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) problems.push("TELEGRAM_BOT_TOKEN falta");
  else if (!BOT_TOKEN.test(token)) problems.push("TELEGRAM_BOT_TOKEN no tiene el formato esperado");

  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) problems.push("TELEGRAM_WEBHOOK_SECRET falta");
  else if (!WEBHOOK_SECRET.test(webhookSecret)) {
    problems.push("TELEGRAM_WEBHOOK_SECRET debe tener 16 a 256 letras, números, _ o -");
  }

  const botUsername = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  if (!botUsername) problems.push("TELEGRAM_BOT_USERNAME falta");
  else if (!BOT_USERNAME.test(botUsername)) {
    problems.push("TELEGRAM_BOT_USERNAME no tiene el formato esperado");
  }

  const origin = parseHttpUrl(env.BETTER_AUTH_URL);
  if (!origin) problems.push("BETTER_AUTH_URL falta o no es una URL");

  const apiBaseRaw = env.TELEGRAM_API_BASE?.trim();
  const apiBase = apiBaseRaw ? parseHttpUrl(apiBaseRaw) : new URL(DEFAULT_TELEGRAM_API_BASE);
  if (!apiBase) problems.push("TELEGRAM_API_BASE no es una URL");
  // The token travels in the URL of every call: in a Vercel production deployment the base must be
  // https (a fake server on http is for tests and local runs only; `VERCEL_ENV` is not set there).
  else if (env.VERCEL_ENV === "production" && apiBase.protocol !== "https:") {
    problems.push("TELEGRAM_API_BASE debe ser https en producción");
  }

  if (problems.length > 0 || !token || !webhookSecret || !botUsername || !origin || !apiBase) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    value: {
      token,
      webhookSecret,
      botUsername,
      apiBase: apiBase.toString().replace(/\/+$/, ""),
      appOrigin: origin.origin,
    },
  };
}

// Push web (R5). The keys come from `pnpm reminders:vapid`, run in the owner's own terminal.
/** A P-256 public key, uncompressed (65 bytes), base64url without padding. */
const VAPID_PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;
/** The matching private key (32 bytes), base64url without padding. */
const VAPID_PRIVATE_KEY = /^[A-Za-z0-9_-]{43}$/;
const MAILTO = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type VapidEnv = {
  publicKey: string;
  /** A secret: never logged, never returned to the client. */
  privateKey: string;
  /** `mailto:` or https URL the push services can reach the owner at. */
  subject: string;
};

export type VapidEnvResult =
  | { ok: true; value: VapidEnv }
  /** `problems` are variable names (and what is wrong), never values. */
  | { ok: false; problems: string[] };

/** Reads and validates what the push channel needs: absent or malformed means "not available". */
export function resolveVapidEnv(env: Env = process.env): VapidEnvResult {
  const problems: string[] = [];
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) problems.push("VAPID_PUBLIC_KEY falta");
  else if (!VAPID_PUBLIC_KEY.test(publicKey)) {
    problems.push("VAPID_PUBLIC_KEY no tiene el formato esperado");
  }

  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!privateKey) problems.push("VAPID_PRIVATE_KEY falta");
  else if (!VAPID_PRIVATE_KEY.test(privateKey)) {
    problems.push("VAPID_PRIVATE_KEY no tiene el formato esperado");
  }

  const subject = env.VAPID_SUBJECT?.trim();
  if (!subject) problems.push("VAPID_SUBJECT falta");
  else if (!MAILTO.test(subject) && parseHttpUrl(subject)?.protocol !== "https:") {
    problems.push("VAPID_SUBJECT debe ser mailto:tu@correo o una URL https");
  }

  if (problems.length > 0 || !publicKey || !privateKey || !subject) return { ok: false, problems };
  return { ok: true, value: { publicKey, privateKey, subject } };
}

/** The webhook URL Telegram is told to call. */
export function telegramWebhookUrl(env: TelegramEnv): string {
  return `${env.appOrigin}/api/telegram/webhook`;
}

/**
 * Compares two secrets in constant time (SHA-256 of both first, so the length of the secret does
 * not leak either). An empty expected secret never matches.
 */
export function safeEqual(received: string, expected: string): boolean {
  if (expected.length === 0) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** `Bearer <token>` → the token (null for anything else). */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * The secrets the tick endpoint accepts. `REMINDERS_CRON_SECRET` is the one GitHub Actions sends.
 * Vercel's own cron sends `Authorization: Bearer $CRON_SECRET` with the project variable of that
 * exact name, so `CRON_SECRET` is accepted too (the owner sets it to the same value).
 */
export function tickSecrets(env: Env = process.env): string[] {
  // Trimmed: a value pasted with a trailing newline must still match the header Actions sends.
  return [env.REMINDERS_CRON_SECRET, env.CRON_SECRET]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 16);
}

/**
 * Whether an `Authorization` header carries one of the tick secrets. Compares against every
 * secret without stopping at the first match.
 */
export function isTickAuthorized(authorization: string | null, env: Env = process.env): boolean {
  const token = bearerToken(authorization);
  const secrets = tickSecrets(env);
  if (!token || secrets.length === 0) return false;
  let matched = false;
  for (const secret of secrets) matched = safeEqual(token, secret) || matched;
  return matched;
}

/**
 * Whether the webhook's secret header matches `TELEGRAM_WEBHOOK_SECRET`. A configured secret that
 * breaks the rule `resolveTelegramEnv` applies (16–256 characters of A-Za-z0-9_-) accepts
 * nothing, so a weak one cannot be what protects the endpoint.
 */
export function isWebhookAuthorized(header: string | null, env: Env = process.env): boolean {
  const expected = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!header || !expected || !WEBHOOK_SECRET.test(expected)) return false;
  return safeEqual(header, expected);
}
