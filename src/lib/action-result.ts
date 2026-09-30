// SPEC-core: Server Actions return an ActionResult and never throw validation errors to the client.
import { z } from "zod";

export type FieldErrors = Record<string, string[]>;

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: FieldErrors };

/** Summary shown above the form when some fields are invalid (each field shows its own). */
export const INVALID_FIELDS_MESSAGE = "Revisa los campos marcados.";
/** No owner session: the session expired, was closed elsewhere, or is not the owner's. */
export const UNAUTHORIZED_MESSAGE = "Tu sesión terminó. Vuelve a entrar para guardar los cambios.";

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/**
 * Failed result. With a ZodError, every field gets its messages (Zod's order, first one first)
 * and `error` is the generic summary.
 */
export function fail<T = never>(error: string | z.ZodError): ActionResult<T> {
  if (typeof error === "string") return { ok: false, error };
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { ok: false, error: INVALID_FIELDS_MESSAGE, fieldErrors };
}

export function unauthorized<T = never>(): ActionResult<T> {
  return fail(UNAUTHORIZED_MESSAGE);
}
