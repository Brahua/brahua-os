"use server";

// H2's Server Actions of `habits`: edit, reorder, archive and reactivate. Each goes through
// ownerAction() (owner first, Zod, an ActionResult); reachable by any POST, so input is
// `unknown`. In a file of their own, apart from actions.ts (HANDOFF "Slots").
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import { refused } from "./failures";
import { HABIT_ERRORS, updateHabitInputSchema, type HabitItem } from "./habit-input";
import {
  archiveHabitById,
  reorderHabitsByIds,
  unarchiveHabitById,
  updateHabitById,
} from "./organize";
import { ORGANIZE_ERRORS } from "./organize-copy";
import {
  archiveHabitInputSchema,
  reorderHabitsInputSchema,
  unarchiveHabitInputSchema,
} from "./organize-input";
import { revalidateHabitScreens } from "./revalidate";

const update = ownerAction(
  updateHabitInputSchema,
  async (data) => {
    const habit = await updateHabitById(getDb(), data, ownerDateKey(new Date()));
    // Either way: a refusal means the page was out of date (an area or the habit archived).
    revalidateHabitScreens();
    if (habit === "archived") return fail<HabitItem>(ORGANIZE_ERRORS.archivedEdit);
    return typeof habit === "string" ? refused<HabitItem>(habit) : ok(habit);
  },
  { name: "updateHabit" },
);

/**
 * Edits an active habit's name, area and frequency (SPEC-habits "Crear y editar"). The frequency
 * can always change. Returns the habit as it is today.
 */
export async function updateHabit(input: unknown): Promise<ActionResult<HabitItem>> {
  return update(input);
}

const reorder = ownerAction(
  reorderHabitsInputSchema,
  async ({ ids }) => {
    const saved = await reorderHabitsByIds(getDb(), ids);
    // Either way: on a stale list, the response brings the current one.
    revalidateHabitScreens();
    return saved ? ok(null) : fail<null>(ORGANIZE_ERRORS.staleOrder);
  },
  { name: "reorderHabits" },
);

/**
 * The manual order: every active habit's id, in the new order (SPEC-habits "Orden"). A list that
 * isn't exactly the active habits is refused without writing (`staleOrder`).
 */
export async function reorderHabits(input: unknown): Promise<ActionResult<null>> {
  return reorder(input);
}

const archive = ownerAction(
  archiveHabitInputSchema,
  async ({ id }) => {
    const habit = await archiveHabitById(getDb(), id, ownerDateKey(new Date()));
    revalidateHabitScreens();
    return habit ? ok(habit) : fail<HabitItem>(HABIT_ERRORS.notFound);
  },
  { name: "archiveHabit" },
);

/** Archives a habit (SPEC-habits "Archivar"): out of "Hoy", everything kept. Twice is fine. */
export async function archiveHabit(input: unknown): Promise<ActionResult<HabitItem>> {
  return archive(input);
}

const unarchive = ownerAction(
  unarchiveHabitInputSchema,
  async (data) => {
    const habit = await unarchiveHabitById(getDb(), data, ownerDateKey(new Date()));
    revalidateHabitScreens();
    return habit ? ok(habit) : fail<HabitItem>(HABIT_ERRORS.notFound);
  },
  { name: "unarchiveHabit" },
);

/**
 * Reactivates an archived habit: at the end of "Hoy" (`position: "end"`, the default) or back in
 * its place (`"original"`, the archive's "Deshacer"). Twice is fine.
 */
export async function unarchiveHabit(input: unknown): Promise<ActionResult<HabitItem>> {
  return unarchive(input);
}
