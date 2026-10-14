"use server";

// Server Actions of `household`'s cleaning (H1). Each one goes through ownerAction(): owner check
// first, Zod, then an ActionResult (SPEC-core "Estilo de código"). The writes are `tasks`'
// contract (`createTaskWithTags`, `completeModuleTask`, …): this module never touches `tasks`'
// tables, and the cleaning is a task tagged `limpieza` (SPEC-household "Decisiones").
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import {
  completeModuleTask,
  createTaskWithTags,
  deleteModuleTask,
  reopenModuleTask,
  restoreModuleTask,
} from "@/modules/tasks/contracts";
import { CLEANING_TAG, nextWeekdayOnOrAfter, recurrenceFor, zoneTagName } from "./cleaning";
import { CLEANING_COPY, CLEANING_ERRORS } from "./cleaning-copy";
import { addCleaningInputSchema, cleaningIdInputSchema } from "./cleaning-input";
import { toCleaningItem, type CleaningItem } from "./cleaning-view";
import { revalidateHousehold } from "./revalidate";

const add = ownerAction(
  addCleaningInputSchema,
  async (data) => {
    const today = ownerDateKey(new Date());
    const weekly = data.frequency === "weekly";
    // Without a first date: today, or for «ciertos días» the first of those days.
    const firstDate =
      data.firstDate ?? (weekly ? nextWeekdayOnOrAfter(today, data.weekdays) : today);
    if (firstDate < today) {
      return {
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { firstDate: [CLEANING_ERRORS.past] },
      } satisfies ActionResult<never>;
    }
    const task = await createTaskWithTags({
      title: data.title,
      dueDate: firstDate,
      recurrence: recurrenceFor(data.frequency, weekly ? data.weekdays : []),
      tags: [CLEANING_TAG, zoneTagName(data.zone)],
    });
    revalidateHousehold();
    return ok(toCleaningItem(task));
  },
  { name: "addCleaning" },
);

/**
 * Adds a cleaning: a recurring task tagged `limpieza` and with its zone, due on its first day
 * (the given one, or the first that fits). It shows in Hoy the day it comes up, like any task.
 */
export async function addCleaning(input: unknown): Promise<ActionResult<CleaningItem>> {
  return add(input);
}

export type CleaningDone = {
  id: string;
  title: string;
  /** The day the next occurrence comes up (YYYY-MM-DD), or null if there was none. */
  nextDueDate: string | null;
};

const done = ownerAction(
  cleaningIdInputSchema,
  async ({ id }) => {
    const result = await completeModuleTask(id);
    revalidateHousehold();
    if (!result) return fail<CleaningDone>(CLEANING_COPY.notFound);
    return ok({ id: result.id, title: result.title, nextDueDate: result.next?.dueDate ?? null });
  },
  { name: "completeCleaning" },
);

/** «Hecho»: completes the cleaning; the rule creates the next one with the same tags. */
export async function completeCleaning(input: unknown): Promise<ActionResult<CleaningDone>> {
  return done(input);
}

const reopen = ownerAction(
  cleaningIdInputSchema,
  async ({ id }) => {
    const result = await reopenModuleTask(id);
    revalidateHousehold();
    return result ? ok({ id: result.id }) : fail<{ id: string }>(CLEANING_COPY.notFound);
  },
  { name: "reopenCleaning" },
);

/** «Deshacer» of «Hecho»: pending again, and the next occurrence goes if nobody touched it. */
export async function reopenCleaning(input: unknown): Promise<ActionResult<{ id: string }>> {
  return reopen(input);
}

const remove = ownerAction(
  cleaningIdInputSchema,
  async ({ id }) => {
    const deleted = await deleteModuleTask(id);
    revalidateHousehold();
    return deleted ? ok(deleted) : fail<{ id: string; title: string }>(CLEANING_COPY.notFound);
  },
  { name: "removeCleaning" },
);

/** «Quitar»: deletes the task (it stays in the export) and with it the series. */
export async function removeCleaning(
  input: unknown,
): Promise<ActionResult<{ id: string; title: string }>> {
  return remove(input);
}

const restore = ownerAction(
  cleaningIdInputSchema,
  async ({ id }) => {
    const result = await restoreModuleTask(id);
    revalidateHousehold();
    return result ? ok({ id: result.id }) : fail<{ id: string }>(CLEANING_COPY.notFound);
  },
  { name: "restoreCleaning" },
);

/** «Deshacer» of «Quitar». */
export async function restoreCleaning(input: unknown): Promise<ActionResult<{ id: string }>> {
  return restore(input);
}
