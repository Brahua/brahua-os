"use server";

// Server Actions of `goals`: create, edit, delete and restore, order, archive, entries and
// achieved. Each one goes through ownerAction(): owner check first, Zod, then an ActionResult
// (SPEC-core "Estilo de código"). Reachable by any POST, so input is `unknown`.
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { ownerDateKey } from "@/lib/time";
import { refused } from "./failures";
import {
  addEntryInputSchema,
  createGoalInputSchema,
  goalIdInputSchema,
  reorderGoalsInputSchema,
  unarchiveGoalInputSchema,
  undoEntryInputSchema,
  updateGoalInputSchema,
  type DeletedGoal,
  type GoalItem,
} from "./goal-input";
import {
  addGoalEntry,
  archiveGoalById,
  insertGoal,
  reorderGoalsByIds,
  restoreGoalById,
  setGoalAchieved,
  softDeleteGoal,
  unarchiveGoalById,
  undoGoalEntry,
  updateGoalById,
  type EntryResult,
} from "./goals";
import { GOAL_ERRORS } from "./goals-copy";
import { revalidateGoalScreens, revalidateWeeklyObjective } from "./revalidate";
import {
  clearWeeklyObjectiveInputSchema,
  setWeeklyObjectiveInputSchema,
  undoWeeklyObjectiveInputSchema,
  type WeeklyObjectiveChange,
  type WeeklyObjectiveUndo,
} from "./weekly-input";
import { clearWeeklyObjectiveRow, undoWeeklyObjectiveRow, upsertWeeklyObjective } from "./weekly";

const create = ownerAction(
  createGoalInputSchema,
  async (data) => {
    const goal = await insertGoal(getDb(), data);
    // Either way: a refusal means the page's areas were out of date.
    revalidateGoalScreens();
    return typeof goal === "string" ? refused<GoalItem>(goal) : ok(goal);
  },
  { name: "createGoal" },
);

/** Creates a goal at the end of the order, in its period (SPEC-goals "Crear"). G1: by quantity. */
export async function createGoal(input: unknown): Promise<ActionResult<GoalItem>> {
  return create(input);
}

const update = ownerAction(
  updateGoalInputSchema,
  async (data) => {
    const goal = await updateGoalById(getDb(), data);
    revalidateGoalScreens();
    return typeof goal === "string" ? refused<GoalItem>(goal) : ok(goal);
  },
  { name: "updateGoal" },
);

/** Edits a goal's title, notes, area, target and unit. Returns the goal as it is now. */
export async function updateGoal(input: unknown): Promise<ActionResult<GoalItem>> {
  return update(input);
}

const remove = ownerAction(
  goalIdInputSchema,
  async ({ id }) => {
    const deleted = await softDeleteGoal(getDb(), id);
    revalidateGoalScreens();
    return deleted ? ok(deleted) : fail<DeletedGoal>(GOAL_ERRORS.notFound);
  },
  { name: "deleteGoal" },
);

/** Soft delete (SPEC-goals "Eliminar"): out of every view with its entries, back with "Deshacer". */
export async function deleteGoal(input: unknown): Promise<ActionResult<DeletedGoal>> {
  return remove(input);
}

const restore = ownerAction(
  goalIdInputSchema,
  async ({ id }) => {
    const goal = await restoreGoalById(getDb(), id);
    revalidateGoalScreens();
    return goal ? ok(goal) : fail<GoalItem>(GOAL_ERRORS.notFound);
  },
  { name: "restoreGoal" },
);

/** "Deshacer" of a delete: back in its place, with its entries. Restoring twice is not an error. */
export async function restoreGoal(input: unknown): Promise<ActionResult<GoalItem>> {
  return restore(input);
}

const reorder = ownerAction(
  reorderGoalsInputSchema,
  async ({ ids }) => {
    const saved = await reorderGoalsByIds(getDb(), ids);
    // Either way: on a stale list, the response brings the current one.
    revalidateGoalScreens();
    return saved ? ok(null) : fail<null>(GOAL_ERRORS.staleOrder);
  },
  { name: "reorderGoals" },
);

/**
 * The manual order: every non-archived goal's id, in the new order. A list that isn't exactly
 * those goals is refused without writing (`staleOrder`).
 */
export async function reorderGoals(input: unknown): Promise<ActionResult<null>> {
  return reorder(input);
}

const archive = ownerAction(
  goalIdInputSchema,
  async ({ id }) => {
    const goal = await archiveGoalById(getDb(), id);
    revalidateGoalScreens();
    return goal ? ok(goal) : fail<GoalItem>(GOAL_ERRORS.notFound);
  },
  { name: "archiveGoal" },
);

/** Archives a goal: it moves to "Anteriores", everything kept. Twice is fine. */
export async function archiveGoal(input: unknown): Promise<ActionResult<GoalItem>> {
  return archive(input);
}

const unarchive = ownerAction(
  unarchiveGoalInputSchema,
  async (data) => {
    const goal = await unarchiveGoalById(getDb(), data);
    revalidateGoalScreens();
    return goal ? ok(goal) : fail<GoalItem>(GOAL_ERRORS.notFound);
  },
  { name: "unarchiveGoal" },
);

/** Reactivates an archived goal: at the end (`"end"`) or back in its place (`"original"`). */
export async function unarchiveGoal(input: unknown): Promise<ActionResult<GoalItem>> {
  return unarchive(input);
}

const addEntry = ownerAction(
  addEntryInputSchema,
  async (data) => {
    const result = await addGoalEntry(getDb(), data, ownerDateKey(new Date()));
    revalidateGoalScreens();
    return typeof result === "string" ? refused<EntryResult>(result) : ok(result);
  },
  { name: "addGoalEntry" },
);

/**
 * "+N": adds an entry to a manual goal (negative to correct), under the goal's lock: two at the
 * same time add up, and reaching the target achieves it once. Returns the goal, the entry's id
 * (its "Deshacer" carries it) and whether this entry achieved the goal.
 */
export async function addEntryToGoal(input: unknown): Promise<ActionResult<EntryResult>> {
  return addEntry(input);
}

const undoEntry = ownerAction(
  undoEntryInputSchema,
  async (data) => {
    const goal = await undoGoalEntry(getDb(), data);
    revalidateGoalScreens();
    return typeof goal === "string" ? refused<GoalItem>(goal) : ok(goal);
  },
  { name: "undoGoalEntry" },
);

/** "Deshacer" of an entry: that exact entry, by its id. Undoing it twice is not an error. */
export async function undoEntryOfGoal(input: unknown): Promise<ActionResult<GoalItem>> {
  return undoEntry(input);
}

const markAchieved = ownerAction(
  goalIdInputSchema,
  async ({ id }) => {
    const goal = await setGoalAchieved(getDb(), id, true);
    revalidateGoalScreens();
    return typeof goal === "string" ? refused<GoalItem>(goal) : ok(goal);
  },
  { name: "markGoalAchieved" },
);

/** "Marcar lograda": the state wanted, so it is idempotent. */
export async function markGoalAchieved(input: unknown): Promise<ActionResult<GoalItem>> {
  return markAchieved(input);
}

const reopen = ownerAction(
  goalIdInputSchema,
  async ({ id }) => {
    const goal = await setGoalAchieved(getDb(), id, false);
    revalidateGoalScreens();
    return typeof goal === "string" ? refused<GoalItem>(goal) : ok(goal);
  },
  { name: "reopenGoal" },
);

/** "Reabrir": back to in progress, clearing the achieved date. Twice is fine. */
export async function reopenGoal(input: unknown): Promise<ActionResult<GoalItem>> {
  return reopen(input);
}

const setWeekly = ownerAction(
  setWeeklyObjectiveInputSchema,
  async (data) => {
    const change = await upsertWeeklyObjective(getDb(), data);
    revalidateWeeklyObjective();
    return ok(change);
  },
  { name: "setWeeklyObjective" },
);

/**
 * Sets or replaces the objective of a week (its Monday): upsert under the week's lock. Returns the
 * text it replaced, which the "Deshacer" carries.
 */
export async function setWeeklyObjective(
  input: unknown,
): Promise<ActionResult<WeeklyObjectiveChange>> {
  return setWeekly(input);
}

const clearWeekly = ownerAction(
  clearWeeklyObjectiveInputSchema,
  async ({ weekStart }) => {
    const change = await clearWeeklyObjectiveRow(getDb(), weekStart);
    revalidateWeeklyObjective();
    return ok(change);
  },
  { name: "clearWeeklyObjective" },
);

/** Clears the objective of a week. Clearing an empty week is not an error. */
export async function clearWeeklyObjective(
  input: unknown,
): Promise<ActionResult<WeeklyObjectiveChange>> {
  return clearWeekly(input);
}

const undoWeekly = ownerAction(
  undoWeeklyObjectiveInputSchema,
  async (data) => {
    const undone = await undoWeeklyObjectiveRow(getDb(), data);
    revalidateWeeklyObjective();
    return ok(undone);
  },
  { name: "undoWeeklyObjective" },
);

/**
 * "Deshacer" of a set or a clear: puts back the text it carries, only while the week still holds
 * what that change left. Undoing twice, or after another edit, changes nothing (`restored: false`).
 */
export async function undoWeeklyObjective(
  input: unknown,
): Promise<ActionResult<WeeklyObjectiveUndo>> {
  return undoWeekly(input);
}
