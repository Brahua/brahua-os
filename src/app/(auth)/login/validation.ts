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

/** Message for a failed sign-in, by HTTP status. Never says which of the two fields was wrong. */
export function signInErrorMessage(status: number | undefined): string {
  if (status === 429) return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
  if (status === 400 || status === 401 || status === 403) {
    return "El email o la contraseña no coinciden. Revísalos y vuelve a probar.";
  }
  return "No se pudo iniciar sesión. Revisa tu conexión y vuelve a probar.";
}
