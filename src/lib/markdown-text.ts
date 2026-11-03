// Validation of long Markdown text written by the owner (project notes, P5; task notes, T2; notes,
// N1). Client-safe: editors run the same checks before sending, and the server action is the
// authority. Each user passes its own limit and messages (`markdownTextSchema`).
import { z } from "zod";

/**
 * Control characters other than line feed and tab (NUL, escape, backspace…). They are invisible,
 * Postgres rejects NUL outright, and carriage returns are folded into line feeds first.
 */
const CONTROL = /(?![\n\t])\p{Cc}/u;

export function hasControlCharacters(value: string): boolean {
  return CONTROL.test(value);
}

/**
 * Bidirectional embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069): invisible,
 * they reorder what is shown (text, or a link's visible address) away from what is stored.
 * The plain marks (U+200E, U+200F) stay: they only nudge punctuation in mixed scripts.
 */
const BIDI_CONTROL = /[‪-‮⁦-⁩]/u;

export function hasBidiControls(value: string): boolean {
  return BIDI_CONTROL.test(value);
}

/**
 * Markdown as stored: Unicode NFC, line breaks as `\n`, without blank lines at the start or
 * whitespace at the end. Leading spaces on the first line stay (they mean code in Markdown).
 */
export function normalizeNotes(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
}

export type MarkdownTextErrors = {
  tooLong: string;
  control: string;
  bidi: string;
};

/**
 * A Markdown text (null reads as empty; a missing value is refused), normalized as stored, at most `maxLength`
 * characters after normalizing, without control characters (except `\n` and `\t`) or bidi
 * controls. The output is the normalized string ("" when empty).
 */
export function markdownTextSchema(maxLength: number, errors: MarkdownTextErrors) {
  return z
    .string()
    .nullable()
    .transform((value) => normalizeNotes(value ?? ""))
    .pipe(
      z
        .string()
        .max(maxLength, errors.tooLong)
        .refine((value) => !hasControlCharacters(value), errors.control)
        .refine((value) => !hasBidiControls(value), errors.bidi),
    );
}
