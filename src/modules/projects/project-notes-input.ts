// Validation of a project's notes (P5, SPEC-projects "Notas"). Client-safe: the notes editor runs
// the same schema before sending, and the server action is the authority. The sanitation itself
// (NFC, line breaks, control and bidi characters) is shared with tasks and notes:
// src/lib/markdown-text.ts.
import { z } from "zod";
import { markdownTextSchema } from "@/lib/markdown-text";
import { PROJECT_NOTES_MAX_LENGTH } from "./project-constants";
import { PROJECT_ERRORS } from "./project-input";

export { PROJECT_NOTES_MAX_LENGTH } from "./project-constants";
export { hasBidiControls, hasControlCharacters, normalizeNotes } from "@/lib/markdown-text";

const formatCount = (n: number) => n.toLocaleString("es");

export const PROJECT_NOTES_ERRORS = {
  tooLong: `Usa ${formatCount(PROJECT_NOTES_MAX_LENGTH)} caracteres como máximo.`,
  control:
    "Quita los caracteres de control de las notas (solo se permiten saltos de línea y tabulaciones).",
  bidi: "Quita los caracteres invisibles que cambian el sentido del texto (marcas bidireccionales).",
} as const;

const notes = markdownTextSchema(PROJECT_NOTES_MAX_LENGTH, PROJECT_NOTES_ERRORS).transform(
  (value) => (value === "" ? null : value),
);

/** Saves the notes (Markdown, up to 20 000 characters). Empty (or null) clears them. */
export const updateProjectNotesInputSchema = z.object({
  id: z.uuid({ error: PROJECT_ERRORS.notFound }),
  notes,
});

export type UpdateProjectNotesInput = z.output<typeof updateProjectNotesInputSchema>;
