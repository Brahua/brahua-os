// Reads of the views of /tasks and of a task's notes for Server Components (T2). Each one checks
// the owner first (SPEC-core).
import "server-only";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { TaskItem } from "./task-input";
import {
  selectDoneTasks,
  selectPendingTasks,
  selectTaskNotes,
  selectTodayTasks,
  selectUpcomingTasks,
} from "./view-data";

/** "Hoy": overdue and due today. */
export async function listTodayTasks(now: Date): Promise<TaskItem[]> {
  await requireOwner();
  return selectTodayTasks(getDb(), now);
}

/** "Próximas": due in the next 7 days, today excluded. */
export async function listUpcomingTasks(now: Date): Promise<TaskItem[]> {
  await requireOwner();
  return selectUpcomingTasks(getDb(), now);
}

/** "Todas": every pending task (the page filters them). */
export async function listPendingTasks(): Promise<TaskItem[]> {
  await requireOwner();
  return selectPendingTasks(getDb());
}

/** "Hechas": done in the last 30 days. */
export async function listDoneTasks(now: Date): Promise<TaskItem[]> {
  await requireOwner();
  return selectDoneTasks(getDb(), now);
}

const taskId = z.uuid();

/** A task's notes for its page (null without notes or when the task isn't visible). */
export async function getTaskNotes(id: string): Promise<string | null> {
  await requireOwner();
  if (!taskId.safeParse(id).success) return null;
  return (await selectTaskNotes(getDb(), id))?.notes ?? null;
}
