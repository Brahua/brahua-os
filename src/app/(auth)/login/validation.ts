// Pure helpers for the login form: client-side checks and user-facing messages (Spanish).
import { isEmail } from "@/lib/auth-env";

export type LoginFields = { email: string; password: string };
export type LoginFieldErrors = Partial<Record<keyof LoginFields, string>>;

export function validateLogin({ email, password }: LoginFields): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const trimmed = email.trim();
  if (!trimmed) errors.email = "Escribe tu email.";
  else if (!isEmail(trimmed))
    errors.email = "Revisa el email: le falta algo como nombre@dominio.com.";
  if (!password) errors.password = "Escribe tu contraseña.";
  return errors;
}

export const CREDENTIALS_MESSAGE =
  "El email o la contraseña no coinciden. Revísalos y vuelve a probar.";
export const RATE_LIMIT_MESSAGE =
  "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
export const GENERIC_MESSAGE = "No se pudo iniciar sesión. Revisa tu conexión y vuelve a probar.";

/**
 * Message for a failed sign-in. Only a credentials rejection (401, or Better Auth's 400 for a
 * malformed email) says "no coinciden", and it never says which field; anything else (403,
 * 5xx, network) is the generic message.
 */
export function signInErrorMessage(
  error: { status?: number; code?: string } | null | undefined,
): string {
  if (error?.status === 429) return RATE_LIMIT_MESSAGE;
  if (error?.status === 401) return CREDENTIALS_MESSAGE;
  if (error?.status === 400 && error.code === "INVALID_EMAIL") return CREDENTIALS_MESSAGE;
  return GENERIC_MESSAGE;
}
