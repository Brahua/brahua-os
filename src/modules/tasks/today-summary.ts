// What `tasks` tells `today` (T6, SPEC-tasks "Contratos"): the pending tasks that are overdue
// or due today, by Lima's calendar day. Pure and client-safe: the DTO, the filter and the order.
// contracts.ts reads the rows (server-only).
import type { TaskPriority } from "./task-constants";
import { taskDueState, type TaskDueState } from "./task-due";
import type { TaskAreaSummary } from "./task-input";
import { compareByDue } from "./task-views";

/** The due states that put a task in the summary. */
export type TaskTodayDue = Extract<TaskDueState, { kind: "overdue" | "today" }>;

/** One task for `today`: only what it needs to show it and link to it (`taskPath(id)`). */
export type TaskTodayItem = {
  id: string;
  title: string;
  priority: TaskPriority;
  /** YYYY-MM-DD (a day in Lima); always set here. */
  dueDate: string;
  /** HH:MM (24 h, Lima) or null; the ones with a time go first within their day. */
  dueTime: string | null;
  /** "Retrasada hace N días" or "Vence hoy" (taskDueState, Lima's day). */
  due: TaskTodayDue;
  /** The area it shows: its own, or its project's (one source of truth). Null in the inbox. */
  area: TaskAreaSummary | null;
  /** Its project, or null. The project's area is `area`. */
  project: { id: string; name: string } | null;
  /** Whether it is its project's next action. */
  isNextAction: boolean;
};

/** A task row as contracts.ts reads it (`createdAt` only orders; it isn't in the DTO). */
export type TaskTodayRow = Omit<TaskTodayItem, "due" | "dueDate"> & {
  dueDate: string | null;
  doneAt: Date | null;
  createdAt: Date;
};

const isTodayDue = (due: TaskDueState | null): due is TaskTodayDue =>
  due !== null && (due.kind === "overdue" || due.kind === "today");

/**
 * The summary from the candidate rows: keeps the pending ones that are overdue or due today (by
 * Lima's day; the query already narrows to them, this is the same rule as the labels) and sorts
 * them like the "Hoy" view: the most overdue first, then (within a day) the ones with a time,
 * by time, then priority (Alta first), then creation
 * (the oldest first), the id last.
 */
export function buildTasksTodaySummary(
  rows: readonly TaskTodayRow[],
  now: Date,
): TaskTodayItem[] {
  const kept: { row: TaskTodayRow & { dueDate: string }; due: TaskTodayDue }[] = [];
  for (const row of rows) {
    const due = taskDueState(row.dueDate, row.doneAt, now);
    if (row.dueDate !== null && isTodayDue(due)) kept.push({ row: { ...row, dueDate: row.dueDate }, due });
  }
  kept.sort((a, b) => compareByDue(a.row, b.row));
  return kept.map(({ row, due }) => ({
    id: row.id,
    title: row.title,
    priority: row.priority,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    due,
    area: row.area,
    project: row.project,
    isNextAction: row.isNextAction,
  }));
}
