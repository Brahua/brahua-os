// The secret of the email ingest endpoint (SPEC-finance-email "Secreto"). Validated here, in one
// place: a problem names the VARIABLE, never its value. The owner generates it in their own terminal
// and pastes it into the Apps Script properties; the agent never sees it.
import { createHash, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

/** 32+ characters without spaces and at least 10 distinct ones: `openssl rand -hex 32` or `-base64 32` fit. */
const SECRET = /^\S{32,256}$/;

export function resolveIngestSecret(
  env: Env = process.env,
): { ok: true; secret: string } | { ok: false; problem: string } {
  const secret = env.FINANCE_EMAIL_SECRET?.trim();
  if (!secret) return { ok: false, problem: "FINANCE_EMAIL_SECRET falta" };
  if (!SECRET.test(secret) || new Set(secret).size < 10) {
    return {
      ok: false,
      problem: "FINANCE_EMAIL_SECRET debe tener 32 o más caracteres, sin espacios",
    };
  }
  return { ok: true, secret };
}

/** Constant time (SHA-256 of both first, so the length does not leak). An empty secret never matches. */
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
