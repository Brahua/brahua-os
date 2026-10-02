// Reads of `tasks` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { DeletedTask, TaskItem, TaskTargets } from "./task-input";
import {
  selectDeletedTaskById,
  selectInboxTasks,
  selectTaskById,
  selectTaskTargets,
} from "./tasks";

const taskId = z.uuid();

/** The inbox: pending tasks without an area or a project, the newest first. */
export async function listInboxTasks(): Promise<TaskItem[]> {
  await requireOwner();
  return selectInboxTasks(getDb());
}

/**
 * One task for its page, or null when the id is malformed, the task doesn't exist or it is
 * deleted. Cached per request: the page and its metadata share one query.
 */
export const getTask = cache(async (id: string): Promise<TaskItem | null> => {
  await requireOwner();
  // Not a uuid: no query (Postgres would reject the cast and quote the value in its error).
  if (!taskId.safeParse(id).success) return null;
  return selectTaskById(getDb(), id);
});

/** A task deleted in the last minutes (the list's undo notice), or null. */
export async function getDeletedTask(id: string): Promise<DeletedTask | null> {
  await requireOwner();
  if (!taskId.safeParse(id).success) return null;
  return selectDeletedTaskById(getDb(), id);
}

/** The active areas and the open projects a task can go in. */
export async function getTaskTargets(): Promise<TaskTargets> {
  await requireOwner();
  return selectTaskTargets(getDb());
}
