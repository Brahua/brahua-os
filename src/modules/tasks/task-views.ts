// The views of /tasks (T2, SPEC-tasks "Pantallas"): which tasks each one shows, in what order,
// and how "Próximas" groups them by day. Pure and client-safe: the server picks and sorts the
// rows with these same functions, and the list uses them as its `belongs` (whether a task still
// belongs to the view after a change). Days are Lima's calendar days; the instant is explicit.
import { formatDateKey, ownerDateKey } from "@/lib/time";
import { daysUntil } from "@/modules/projects/progress";
import type { TaskItem } from "./task-input";
import { compareDueTime } from "./task-time";

/** "Próximas": due in the next 7 days, today excluded (today is in "Hoy"). */
export const UPCOMING_DAYS = 7;

/**
 * "Hechas": done in the last 30 days, by Lima's calendar (from Lima's midnight 30 days before
 * today), so the window and the "Hecha el …" labels count the same days.
 */
export const DONE_WINDOW_DAYS = 30;

type ViewTask = Pick<TaskItem, "dueDate" | "doneAt">;

/** "Hoy": pending, and overdue or due today (Lima). */
export function isDueByToday(task: ViewTask, now: Date): boolean {
  return task.doneAt === null && task.dueDate !== null && daysUntil(task.dueDate, now) <= 0;
}

/** "Próximas": pending and due tomorrow up to 7 days from today (Lima). */
export function isUpcoming(task: ViewTask, now: Date): boolean {
  if (task.doneAt !== null || task.dueDate === null) return false;
  const left = daysUntil(task.dueDate, now);
  return left >= 1 && left <= UPCOMING_DAYS;
}

/** "Hechas": done on Lima's day 30 days before today or later. */
export function isRecentlyDone(task: Pick<TaskItem, "doneAt">, now: Date): boolean {
  return task.doneAt !== null && ownerDateKey(task.doneAt) >= doneSinceDay(now);
}

/** The first Lima day "Hechas" includes (YYYY-MM-DD, for the query). */
export const doneSinceDay = (now: Date) => addDays(ownerDateKey(now), -DONE_WINDOW_DAYS);

// ── Filters of "Todas" (in the URL) ──────────────────────────────────────────────────────────

/**
 * What "Todas" is filtered by. `areaId` matches the area the task shows (its own, or its
 * project's: one source of truth). Missing means "all".
 */
export type TaskFilters = {
  areaId: string | null;
  projectId: string | null;
  /** T4: the tag id (stable under a rename; `?etiqueta=<tagId>`). */
  tagId: string | null;
};

export const NO_FILTERS: TaskFilters = { areaId: null, projectId: null, tagId: null };

type FilterTask = Pick<TaskItem, "area" | "projectId" | "tags">;

export function matchesFilters(task: FilterTask, filters: TaskFilters): boolean {
  if (filters.areaId !== null && task.area?.id !== filters.areaId) return false;
  if (filters.projectId !== null && task.projectId !== filters.projectId) return false;
  if (filters.tagId !== null && !task.tags.some((tag) => tag.id === filters.tagId)) return false;

  return true;
}

/** "Todas": pending, and matching the filters. */
export function isPendingMatching(
  task: ViewTask & FilterTask,
  filters: TaskFilters,
): boolean {
  return task.doneAt === null && matchesFilters(task, filters);
}

// ── Order ─────────────────────────────────────────────────────────────────────────────────────

/** High first. */
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

type SortTask = Pick<TaskItem, "id" | "dueDate" | "dueTime" | "priority" | "createdAt">;

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * "Hoy", "Próximas" and "Todas": by due date (the oldest first; without a date, last), then
 * time (the ones with one first, by time), then priority (Alta first), then creation (the oldest first). The id breaks the last ties, so the
 * order never flickers between two loads.
 */
export function compareByDue(a: SortTask, b: SortTask): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  // polish -> task-time: within a day, the ones with a time first, by time (the day, and so the
  // overdue order, always decides before the hour).
  const time = compareDueTime(a.dueTime, b.dueTime);
  if (time !== 0) return time;
  const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (priority !== 0) return priority;
  const created = a.createdAt.getTime() - b.createdAt.getTime();
  return created !== 0 ? created : byId(a, b);
}

/** "Hechas": the most recently done first. */
export function compareByDoneDesc(a: Pick<TaskItem, "id" | "doneAt">, b: Pick<TaskItem, "id" | "doneAt">) {
  const diff = (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0);
  return diff !== 0 ? diff : byId(a, b);
}

// ── "Próximas" by day ─────────────────────────────────────────────────────────────────────────

// A YYYY-MM-DD day has no time zone: read as UTC so it never shifts.
const DAY_PARTS = new Intl.DateTimeFormat("es-PE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** "Mañana", then "Jueves 8 de octubre" (Lima's calendar; the year is always this week's). */
export function upcomingDayLabel(dueDate: string, now: Date): string {
  if (daysUntil(dueDate, now) === 1) return "Mañana";
  const parts = DAY_PARTS.formatToParts(new Date(`${dueDate}T00:00:00Z`));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const weekday = part("weekday");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${part("day")} de ${part("month")}`;
}

export type TaskGroup = { key: string; label: string };

/** The group of a task in "Próximas": its due day. */
export function upcomingGroup(task: Pick<TaskItem, "dueDate">, now: Date): TaskGroup {
  const key = task.dueDate ?? "";
  return { key, label: key ? upcomingDayLabel(key, now) : "" };
}

/**
 * Consecutive runs of `tasks` with the same group, in order (the list is already sorted by day,
 * so each day is one run).
 */
export function groupRuns<T>(
  tasks: readonly T[],
  groupOf: (task: T) => TaskGroup,
): { group: TaskGroup; tasks: T[] }[] {
  const runs: { group: TaskGroup; tasks: T[] }[] = [];
  for (const task of tasks) {
    const group = groupOf(task);
    const last = runs.at(-1);
    if (last && last.group.key === group.key) last.tasks.push(task);
    else runs.push({ group, tasks: [task] });
  }
  return runs;
}

// ── "Hechas" ──────────────────────────────────────────────────────────────────────────────────

/** "Hecha hoy", "Hecha ayer" or "Hecha el 28 sept. 2026" (Lima's day of the instant). */
export function doneLabel(doneAt: Date, now: Date): string {
  const day = ownerDateKey(doneAt);
  const ago = -daysUntil(day, now);
  if (ago <= 0) return "Hecha hoy";
  if (ago === 1) return "Hecha ayer";
  return `Hecha el ${formatDateKey(day, "short")}`;
}

/** Lima's day `days` after `day` (YYYY-MM-DD), for the query's bounds. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Today in Lima (YYYY-MM-DD). */
export const limaToday = (now: Date) => ownerDateKey(now);
