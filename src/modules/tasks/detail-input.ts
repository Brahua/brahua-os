// Validation of the detail additions of T2 (notes and milestone). Client-safe: the sections run
// the same schemas before sending, and the server actions are the authority. In their own file
// (not task-input.ts) so T2–T4, built in parallel, never edit the same lines.
import { z } from "zod";
import {
  hasBidiControls,
  hasControlCharacters,
  normalizeNotes,
} from "@/modules/projects/project-notes-input";
import { TASK_NOTES_MAX_LENGTH } from "./task-constants";
import { TASK_ERRORS } from "./task-input";

export { TASK_NOTES_MAX_LENGTH } from "./task-constants";

/** From this many characters on, the notes editor shows how many are used. */
export const TASK_NOTES_COUNTER_FROM = TASK_NOTES_MAX_LENGTH - 2_000;

const formatCount = (n: number) => n.toLocaleString("es");

export const TASK_NOTES_ERRORS = {
  tooLong: `Usa ${formatCount(TASK_NOTES_MAX_LENGTH)} caracteres como máximo.`,
  control:
    "Quita los caracteres de control de las notas (solo se permiten saltos de línea y tabulaciones).",
  bidi: "Quita los caracteres invisibles que cambian el sentido del texto (marcas bidireccionales).",
} as const;

const id = z.uuid({ error: TASK_ERRORS.notFound });

/**
 * Notes as stored, like a project's (P5): NFC, `\n` line breaks, no blank lines at the start or
 * whitespace at the end, ≤ 20 000, no control characters other than `\n` and `\t`, no
 * bidirectional controls. Empty (or null) clears them.
 */
const notes = z
  .string()
  .nullable()
  .transform((value) => normalizeNotes(value ?? ""))
  .pipe(
    z
      .string()
      .max(TASK_NOTES_MAX_LENGTH, TASK_NOTES_ERRORS.tooLong)
      .refine((value) => !hasControlCharacters(value), TASK_NOTES_ERRORS.control)
      .refine((value) => !hasBidiControls(value), TASK_NOTES_ERRORS.bidi),
  )
  .transform((value) => (value === "" ? null : value));

export const updateTaskNotesInputSchema = z.object({ id, notes });
export type UpdateTaskNotesInput = z.output<typeof updateTaskNotesInputSchema>;

/** Reading a task's notes (the detail sheet asks when it opens). */
export const taskNotesInputSchema = z.object({ id });

/**
 * Sets (a milestone id) or clears (`null` or `""`) the task's milestone. The key is required: a
 * missing `milestoneId` is a validation error, never a silent clear.
 */
export const setTaskMilestoneInputSchema = z.object({
  id,
  milestoneId: z
    .union([z.literal(""), z.null(), z.uuid({ error: TASK_ERRORS.milestone })], {
      error: TASK_ERRORS.milestone,
    })
    .transform((value) => (value === "" ? null : value)),
});

/** The milestones a task of this project can be in. */
export const taskMilestoneOptionsInputSchema = z.object({
  projectId: z.uuid({ error: TASK_ERRORS.project }),
});
