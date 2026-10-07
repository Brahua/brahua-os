// Postponing a task ("Mañana" in one tap, "Otro día…"): the input, the target day and the
// results of the actions. Pure and client-safe: the instant is explicit (Lima's calendar day), so
// nothing depends on the host's time zone. The actions are in `postpone-actions.ts`.
import { z } from "zod";
import { ownerDateKey } from "@/lib/time";
import { TASK_ERRORS, taskIdInputSchema } from "./task-input";
import { addDays } from "./task-views";

export const POSTPONE_ERRORS = {
  pastDay: "Elige hoy o un día que venga.",
  notPending: "Esta tarea ya está hecha; no hay nada que mover.",
} as const;

/** `to`: the next Lima day, or a day (YYYY-MM-DD, a real calendar date). */
const target = z.union([z.literal("tomorrow"), z.iso.date({ error: TASK_ERRORS.dateInvalid })]);

export type PostponeTarget = z.infer<typeof target>;

export const postponeTaskInputSchema = taskIdInputSchema.extend({ to: target });

/**
 * "Deshacer": puts `dueDate` back, only if the task still has `expected` (the day the postponement
 * set). If someone edited it meanwhile, the undo changes nothing (it never overwrites a newer edit).
 */
export const restoreDueDateInputSchema = taskIdInputSchema.extend({
  dueDate: z.iso.date({ error: TASK_ERRORS.dateInvalid }).nullable(),
  expected: z.iso.date({ error: TASK_ERRORS.dateInvalid }),
});

/** Tomorrow by Lima's calendar day (23:59 is still the same day; midnight is the next one). */
export const tomorrowOf = (now: Date): string => addDays(ownerDateKey(now), 1);

/** The day a postponement lands on, or null when it would be before today in Lima. */
export function postponeDay(to: PostponeTarget, now: Date): string | null {
  const today = ownerDateKey(now);
  const day = to === "tomorrow" ? tomorrowOf(now) : to;
  return day < today ? null : day;
}

/** What `postponeTask` answers: the minimum the UI needs, and what "Deshacer" restores. */
export type PostponedTask = {
  id: string;
  title: string;
  /** The day it has now (YYYY-MM-DD). */
  dueDate: string;
  /** The day it had before (null: none). "Deshacer" puts exactly this back. */
  previousDueDate: string | null;
  /** False when it already was on that day (a double tap): nothing moved, nothing to undo. */
  changed: boolean;
};

/** What `restoreTaskDueDate` answers: the day it has now and whether this call changed it. */
export type RestoredDueDate = { id: string; dueDate: string | null; restored: boolean };
