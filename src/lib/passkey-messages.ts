// User-facing messages (Spanish) for the passkey flows. Pure: safe to unit test.
// Errors come from the Better Auth passkey client: browser-side WebAuthn failures carry
// @simplewebauthn codes (`ERROR_*`) with status 400; server-side ones carry the plugin codes.

export type PasskeyError = { status?: number; code?: string } | null | undefined;

/**
 * Codes that mean the person closed or ignored the browser prompt, or that another ceremony
 * replaced this one. @simplewebauthn only uses ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY for
 * NotAllowedError, which is how browsers report "cancelled" and "timed out". Nothing went
 * wrong: the page stays as it was, with no message. (Better Auth's AUTH_CANCELLED is not here:
 * its client also uses it for network failures.)
 */
const CANCELLED_CODES = new Set(["ERROR_CEREMONY_ABORTED", "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"]);

/** Server-side rejections of an assertion: unknown passkey, bad signature, stale challenge… */
const SIGN_IN_REJECTED_CODES = new Set([
  "PASSKEY_NOT_FOUND",
  "AUTHENTICATION_FAILED",
  "CHALLENGE_NOT_FOUND",
  // The session hook refused it: the passkey is not the owner's.
  "UNABLE_TO_CREATE_SESSION",
]);

export const PASSKEY_UNSUPPORTED_MESSAGE =
  "Este navegador no admite passkeys. Entra con tu email y tu contraseña.";
export const PASSKEY_SIGN_IN_FAILED_MESSAGE =
  "No se pudo entrar con esa passkey. Prueba otra vez o entra con tu contraseña.";
export const PASSKEY_RATE_LIMIT_MESSAGE =
  "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
export const PASSKEY_GENERIC_MESSAGE =
  "No se pudo usar la passkey. Revisa tu conexión y vuelve a probar.";

export function isPasskeyCancellation(error: PasskeyError): boolean {
  return Boolean(error?.code && CANCELLED_CODES.has(error.code));
}

/** True when the server looked at an assertion and rejected it (vs. network or rate limit). */
export function isPasskeySignInRejection(error: PasskeyError): boolean {
  return Boolean(error?.code && SIGN_IN_REJECTED_CODES.has(error.code));
}

/** Message for a failed passkey sign-in, or null when the person just cancelled. */
export function passkeySignInErrorMessage(error: PasskeyError): string | null {
  if (isPasskeyCancellation(error)) return null;
  if (error?.status === 429) return PASSKEY_RATE_LIMIT_MESSAGE;
  if (isPasskeySignInRejection(error)) return PASSKEY_SIGN_IN_FAILED_MESSAGE;
  // Browser-side WebAuthn failures (wrong domain, authenticator error…).
  if (error?.status === 400 && error.code?.startsWith("ERROR_")) {
    return PASSKEY_SIGN_IN_FAILED_MESSAGE;
  }
  return PASSKEY_GENERIC_MESSAGE;
}

export const PASSKEY_REGISTER_UNSUPPORTED_MESSAGE =
  "Este navegador no admite passkeys. Regístrala desde otro navegador o dispositivo.";
export const PASSKEY_REGISTERED_MESSAGE = "Passkey registrada. Ya puedes entrar con ella.";
export const PASSKEY_ALREADY_REGISTERED_MESSAGE =
  "Este dispositivo ya tiene una passkey registrada para brahua-os.";
export const PASSKEY_SESSION_NOT_FRESH_MESSAGE =
  "Por seguridad, los cambios en tus passkeys piden haber entrado hace poco: cierra sesión, vuelve a entrar con tu contraseña y pruébalo de nuevo.";
export const PASSKEY_SESSION_EXPIRED_MESSAGE =
  "Tu sesión terminó. Vuelve a iniciar sesión para cambiar tus passkeys.";
export const PASSKEY_REGISTER_FAILED_MESSAGE =
  "No se pudo registrar la passkey. Revisa tu conexión y vuelve a probar.";
export const PASSKEY_NAME_FAILED_MESSAGE =
  "La passkey quedó registrada, pero no se pudo guardar su nombre.";
export const PASSKEY_DELETED_MESSAGE = "Passkey eliminada.";
export const PASSKEY_DELETE_FAILED_MESSAGE =
  "No se pudo eliminar la passkey. Revisa tu conexión y vuelve a probar.";

/** Session problems shared by every passkey change (register, rename, delete). */
function sessionMessage(error: PasskeyError): string | null {
  // Only Better Auth's "session too old" code; any other 403 is a generic failure.
  if (error?.code === "SESSION_NOT_FRESH") return PASSKEY_SESSION_NOT_FRESH_MESSAGE;
  if (error?.status === 401) return PASSKEY_SESSION_EXPIRED_MESSAGE;
  if (error?.status === 429) return PASSKEY_RATE_LIMIT_MESSAGE;
  return null;
}

/** Message for a failed registration, or null when the person just cancelled. */
export function passkeyRegisterErrorMessage(error: PasskeyError): string | null {
  if (isPasskeyCancellation(error)) return null;
  if (error?.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return PASSKEY_ALREADY_REGISTERED_MESSAGE;
  }
  return sessionMessage(error) ?? PASSKEY_REGISTER_FAILED_MESSAGE;
}

/** Message for a failed deletion. */
export function passkeyDeleteErrorMessage(error: PasskeyError): string {
  return sessionMessage(error) ?? PASSKEY_DELETE_FAILED_MESSAGE;
}
