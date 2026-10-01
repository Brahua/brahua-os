// Validation and client types of a project's milestones (SPEC-projects "Hitos", P3). Client-safe:
// the server actions are the authority, and the section runs the same schemas first so errors
// show without a round trip.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { MILESTONE_TITLE_MAX_LENGTH } from "./project-constants";
import { PROJECT_ERRORS } from "./project-input";

export { MILESTONE_TITLE_MAX_LENGTH } from "./project-constants";

/** A project holds at most this many milestones (and a reorder sends at most this many ids). */
export const MAX_MILESTONES_PER_PROJECT = 100;

export const MILESTONE_ERRORS = {
  titleRequired: "El título es obligatorio.",
  titleTooLong: `Usa ${MILESTONE_TITLE_MAX_LENGTH} caracteres como máximo.`,
  titleInvisible: "Quita los caracteres invisibles o de control del título.",
  dateInvalid: "Escribe una fecha válida.",
  notFound: "Este hito ya no existe (se eliminó). Ya ves la lista actual.",
  tooMany: `Un proyecto puede tener hasta ${MAX_MILESTONES_PER_PROJECT} hitos.`,
  order: "El orden enviado no es válido. Recarga la página e inténtalo de nuevo.",
  staleOrder: "Los hitos cambiaron mientras tanto. Ya ves la lista actual; vuelve a moverlo.",
} as const;

/** A milestone as the page shows it (never the whole row). */
export type ProjectMilestoneItem = {
  id: string;
  title: string;
  /** A day in Lima, YYYY-MM-DD. */
  dueDate: string | null;
  /** When it was checked; null while it is pending. */
  doneAt: Date | null;
  /** Contiguous per project (0…n-1). */
  sortOrder: number;
};

/** Done and total milestones of a project (what the progress is computed from). */
export type MilestoneCounts = { done: number; total: number };

/** The title as stored: like names (NFC, collapsed whitespace, trimmed), 1–120 characters. */
const title = z
  .string({ error: MILESTONE_ERRORS.titleRequired })
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, MILESTONE_ERRORS.titleRequired)
      .max(MILESTONE_TITLE_MAX_LENGTH, MILESTONE_ERRORS.titleTooLong)
      .refine((value) => !hasInvisibleCharacters(value), MILESTONE_ERRORS.titleInvisible),
  );

/** An optional day (YYYY-MM-DD, a real calendar date). "", null or missing clear it. */
const dueDate = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.iso.date({ error: MILESTONE_ERRORS.dateInvalid }).nullable(),
);

/** The project the milestone belongs to: every action checks the milestone is really its. */
const projectId = z.uuid({ error: PROJECT_ERRORS.notFound });
const id = z.uuid({ error: MILESTONE_ERRORS.notFound });

/**
 * Add at the end. The id comes from the client (a random uuid), so the row on screen can be
 * checked, edited or moved before the server answers: those calls queue behind this one.
 */
export const addMilestoneInputSchema = z.object({ projectId, id, title });

/** Title and due date together (one small form). */
export const updateMilestoneInputSchema = z.object({ projectId, id, title, dueDate });

/** The checkbox: done stamps `done_at` (kept if it was already done), pending clears it. */
export const setMilestoneDoneInputSchema = z.object({
  projectId,
  id,
  done: z.boolean({ error: MILESTONE_ERRORS.notFound }),
});

/** Delete (a soft delete: see milestones.ts). */
export const milestoneRefInputSchema = z.object({ projectId, id });

/**
 * "Deshacer" after a delete: the same row back (id, title, date, done) at the position it had.
 * Restoring one that exists in the project changes nothing.
 */
export const restoreMilestoneInputSchema = z.object({
  projectId,
  id,
  /** The live milestone it had right above it (null: it was first). Wins over `position`. */
  afterId: z.uuid({ error: MILESTONE_ERRORS.order }).nullable().default(null),
  position: z
    .number({ error: MILESTONE_ERRORS.order })
    .int(MILESTONE_ERRORS.order)
    .min(0, MILESTONE_ERRORS.order)
    .max(MAX_MILESTONES_PER_PROJECT, MILESTONE_ERRORS.order),
});

/**
 * Reorder: every milestone id of the project, in the new order. The action also checks that
 * they are exactly the project's milestones (else the list on screen was stale).
 */
export const reorderMilestonesInputSchema = z.object({
  projectId,
  ids: z
    .array(z.uuid({ error: MILESTONE_ERRORS.order }), { error: MILESTONE_ERRORS.order })
    .min(1, MILESTONE_ERRORS.order)
    .max(MAX_MILESTONES_PER_PROJECT, MILESTONE_ERRORS.order)
    .refine((ids) => new Set(ids).size === ids.length, MILESTONE_ERRORS.order),
});

export type AddMilestoneInput = z.output<typeof addMilestoneInputSchema>;
export type UpdateMilestoneInput = z.output<typeof updateMilestoneInputSchema>;
export type SetMilestoneDoneInput = z.output<typeof setMilestoneDoneInputSchema>;
export type MilestoneRefInput = z.output<typeof milestoneRefInputSchema>;
export type RestoreMilestoneInput = z.output<typeof restoreMilestoneInputSchema>;
