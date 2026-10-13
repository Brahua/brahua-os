// Reads of `goals` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getHabitOptions } from "@/modules/habits/contracts";
import { getProjectOptions } from "@/modules/projects/contracts";
import type { DeletedGoal, GoalEntryItem, GoalItem, GoalSourceOptions } from "./goal-input";
import {
  selectDeletedGoal,
  selectGoalEntries,
  selectGoalForPage,
  selectVisibleGoals,
} from "./goals";

const goalId = z.uuid();

/**
 * Every visible goal, archived ones too, in their manual order: the page sorts them into sections.
 * Habit and project goals come with what their source read, and the ones that reached their
 * target are achieved here (once, see `settleSourceAchievements`).
 */
export async function listGoals(): Promise<GoalItem[]> {
  await requireOwner();
  return selectVisibleGoals(getDb());
}

/**
 * A goal for its page, or null when it doesn't exist, is deleted or the id is malformed (the
 * page is a 404). Cached per request: the page's metadata reads it too.
 */
export const getGoal = cache(async (id: string): Promise<GoalItem | null> => {
  await requireOwner();
  // Not a uuid: no query (Postgres would reject the cast and quote the value in its error).
  if (!goalId.safeParse(id).success) return null;
  return selectGoalForPage(getDb(), id);
});

/** A goal's entries, newest first (its page's history). */
export async function listGoalEntries(id: string): Promise<GoalEntryItem[]> {
  await requireOwner();
  if (!goalId.safeParse(id).success) return [];
  return selectGoalEntries(getDb(), id);
}

/**
 * A goal just deleted from its page (`?deleted=<id>` on /goals: "Meta eliminada · Deshacer"), or
 * null when the id is malformed, missing or the goal isn't deleted.
 */
export async function getDeletedGoal(id: string): Promise<DeletedGoal | null> {
  await requireOwner();
  if (!goalId.safeParse(id).success) return null;
  return selectDeletedGoal(getDb(), id);
}

/** The active habits and the projects in the works a goal can follow, by their contracts. */
export async function listGoalSourceOptions(): Promise<GoalSourceOptions> {
  await requireOwner();
  const [habits, projects] = await Promise.all([getHabitOptions(), getProjectOptions()]);
  return { habits, projects };
}
