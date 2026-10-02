"use server";

// Server Actions of `habits` (create, delete, restore). Each one goes through ownerAction(): owner
// check first, Zod, then an ActionResult (SPEC-core "Estilo de código"). Reachable by any POST,
// so input is `unknown`. Logging a day lives in log-actions.ts; H2–H4 add their actions in files
// of their own (e.g. `order-actions.ts`, `pause-actions.ts`), not here.
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import { refused } from "./failures";
import {
  createHabitInputSchema,
  HABIT_ERRORS,
  habitIdInputSchema,
  type DeletedHabit,
  type HabitItem,
} from "./habit-input";
import { insertHabit, restoreHabitById, softDeleteHabit } from "./habits";
import { revalidateHabitScreens } from "./revalidate";

const create = ownerAction(
  createHabitInputSchema,
  async (data) => {
    const habit = await insertHabit(getDb(), data, ownerDateKey(new Date()));
    // Revalidate either way: a refusal means the page's areas were out of date.
    revalidateHabitScreens();
    return typeof habit === "string" ? refused<HabitItem>(habit) : ok(habit);
  },
  { name: "createHabit" },
);

/**
 * Creates a habit at the end of "Hoy", starting today. H1: a daily yes/no habit to keep, with a
 * name and optionally an active area.
 */
export async function createHabit(input: unknown): Promise<ActionResult<HabitItem>> {
  return create(input);
}

const remove = ownerAction(
  habitIdInputSchema,
  async ({ id }) => {
    const deleted = await softDeleteHabit(getDb(), id);
    revalidateHabitScreens();
    return deleted ? ok(deleted) : fail(HABIT_ERRORS.notFound);
  },
  { name: "deleteHabit" },
);

/** Soft delete (SPEC-habits "Eliminar"): out of every view with its logs, back with "Deshacer". */
export async function deleteHabit(input: unknown): Promise<ActionResult<DeletedHabit>> {
  return remove(input);
}

const restore = ownerAction(
  habitIdInputSchema,
  async ({ id }) => {
    const habit = await restoreHabitById(getDb(), id, ownerDateKey(new Date()));
    revalidateHabitScreens();
    return habit ? ok(habit) : fail(HABIT_ERRORS.notFound);
  },
  { name: "restoreHabit" },
);

/** "Deshacer" of a delete: back in its place, with its logs. Restoring twice is not an error. */
export async function restoreHabit(input: unknown): Promise<ActionResult<HabitItem>> {
  return restore(input);
}
