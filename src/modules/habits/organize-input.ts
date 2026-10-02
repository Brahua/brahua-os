// Validation of H2's order, archive and reactivate actions (client-safe, like habit-input.ts).
import { z } from "zod";
import { HABIT_ERRORS, habitIdInputSchema } from "./habit-input";
import { ORGANIZE_ERRORS } from "./organize-copy";

/** Far above any real list; bounds the work a single request can ask for. */
export const MAX_HABITS_IN_ORDER = 500;

/**
 * Reorder: every active habit's id, in the new order, without repeats. The server also checks
 * that they are exactly the active habits (`planReorder`): a stale or tampered list is refused.
 */
export const reorderHabitsInputSchema = z.object({
  ids: z
    .array(z.uuid({ error: ORGANIZE_ERRORS.order }), { error: ORGANIZE_ERRORS.order })
    .min(1, ORGANIZE_ERRORS.order)
    .max(MAX_HABITS_IN_ORDER, ORGANIZE_ERRORS.order)
    .refine((ids) => new Set(ids).size === ids.length, ORGANIZE_ERRORS.order),
});

/** Archive. */
export const archiveHabitInputSchema = habitIdInputSchema;

/**
 * Reactivate: at the end of "Hoy" ("Reactivar", like a new habit) or back in its old place
 * (`original`: the "Deshacer" of an archive).
 */
export const unarchiveHabitInputSchema = z.object({
  id: z.uuid({ error: HABIT_ERRORS.notFound }),
  position: z.enum(["end", "original"]).default("end"),
});

export type UnarchiveHabitInput = z.output<typeof unarchiveHabitInputSchema>;
