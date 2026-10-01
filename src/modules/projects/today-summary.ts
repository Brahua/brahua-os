// What `projects` tells `today` (P6, SPEC-projects "Contratos con otros módulos"): the projects
// that are due within a week or overdue, and the blocked ones. Pure and client-safe: the DTO,
// the date limit and the order. contracts.ts reads the rows (server-only).
import { ownerDateKey } from "@/lib/time";
import type { ActiveBlocker } from "./dependency-input";
import type { ProjectPriority, ProjectStatus } from "./project-constants";
import type { ProjectAreaSummary } from "./project-input";
import { DUE_SOON_DAYS, dueState, type DueState } from "./progress";

/** Statuses whose due date counts for `today` (the same ones that show a due notice). */
export const TODAY_DUE_STATUSES = [
  "idea",
  "active",
  "paused",
] as const satisfies readonly ProjectStatus[];

/** One project for `today`: only what it needs to show and link to it. */
export type ProjectTodayItem = {
  id: string;
  name: string;
  area: ProjectAreaSummary;
  status: ProjectStatus;
  priority: ProjectPriority;
  /** YYYY-MM-DD, or null. Set even when `due` is null (e.g. a blocked project due later). */
  dueDate: string | null;
  /** "Vence hoy", "Vence en N días" or "Vencido hace N días" (Lima's day); null if none. */
  due: DueState | null;
  /** The projects that still block it (P4's rule), by name; empty when it isn't blocked. */
  blockedBy: ActiveBlocker[];
};

/** A project row as contracts.ts reads it. */
export type ProjectTodayRow = Omit<ProjectTodayItem, "due" | "blockedBy">;

const DAY_MS = 86_400_000;

/**
 * The last day that is "due soon" (Lima's today + 7) as YYYY-MM-DD: a project due on or before
 * it may show up in the summary. Calendar math on the key, so no time zone is involved.
 */
export function dueSoonLimit(now: Date): string {
  const [year, month, day] = ownerDateKey(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + DUE_SOON_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

const PRIORITY_RANK: Record<ProjectPriority, number> = { high: 0, medium: 1, low: 2 };
const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Days from today to the due date: overdue is negative; no notice sorts last. */
function urgency(item: ProjectTodayItem): number {
  if (!item.due) return Number.POSITIVE_INFINITY;
  return item.due.kind === "overdue" ? -item.due.days : item.due.days;
}

/**
 * Overdue first (the oldest first), then due soonest, then the ones without a notice (blocked
 * only); ties by priority (high first), name (Spanish order) and id.
 */
export function compareTodayItems(a: ProjectTodayItem, b: ProjectTodayItem): number {
  const ua = urgency(a);
  const ub = urgency(b);
  if (ua !== ub) return ua < ub ? -1 : 1;
  const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (priority !== 0) return priority;
  return collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The summary from the candidate rows and the active blockers (by project id): a project stays
 * if it has a due notice (in Idea, Activo or Pausado, due within 7 days or overdue, by Lima's
 * day) or something still blocks it. Sorted with compareTodayItems.
 */
export function buildTodaySummary(
  rows: readonly ProjectTodayRow[],
  blockers: ReadonlyMap<string, ActiveBlocker[]>,
  now: Date,
): ProjectTodayItem[] {
  const items: ProjectTodayItem[] = [];
  for (const row of rows) {
    const due = dueState(row.dueDate, row.status, now);
    const blockedBy = blockers.get(row.id) ?? [];
    if (due || blockedBy.length > 0) items.push({ ...row, due, blockedBy });
  }
  return items.sort(compareTodayItems);
}
