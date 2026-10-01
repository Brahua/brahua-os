// Validation of a project's notes (P5, SPEC-projects "Notas"). Client-safe: the notes editor runs
// the same schema before sending, and the server action is the authority.
import { z } from "zod";
import { PROJECT_NOTES_MAX_LENGTH } from "./project-constants";
import { PROJECT_ERRORS } from "./project-input";

export { PROJECT_NOTES_MAX_LENGTH } from "./project-constants";

const formatCount = (n: number) => n.toLocaleString("es");

export const PROJECT_NOTES_ERRORS = {
  tooLong: `Usa ${formatCount(PROJECT_NOTES_MAX_LENGTH)} caracteres como máximo.`,
  control:
    "Quita los caracteres de control de las notas (solo se permiten saltos de línea y tabulaciones).",
} as const;

/**
 * Control characters other than line feed and tab (NUL, escape, backspace…). They are invisible,
 * Postgres rejects NUL outright, and carriage returns are folded into line feeds first.
 */
const CONTROL = /(?![\n\t])\p{Cc}/u;

export function hasControlCharacters(value: string): boolean {
  return CONTROL.test(value);
}

/**
 * Notes as stored: Unicode NFC, line breaks as `\n`, without blank lines at the start or
 * whitespace at the end. Leading spaces on the first line stay (they mean code in Markdown).
 */
export function normalizeNotes(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
}

const notes = z
  .string()
  .nullable()
  .transform((value) => normalizeNotes(value ?? ""))
  .pipe(
    z
      .string()
      .max(PROJECT_NOTES_MAX_LENGTH, PROJECT_NOTES_ERRORS.tooLong)
      .refine((value) => !hasControlCharacters(value), PROJECT_NOTES_ERRORS.control),
  )
  .transform((value) => (value === "" ? null : value));

/** Saves the notes (Markdown, up to 20 000 characters). Empty (or null) clears them. */
export const updateProjectNotesInputSchema = z.object({
  id: z.uuid({ error: PROJECT_ERRORS.notFound }),
  notes,
});

export type UpdateProjectNotesInput = z.output<typeof updateProjectNotesInputSchema>;
