// Progress and due-date math of `projects` (SPEC-projects "Decisiones"). Pure and client-safe:
// every function takes the instant explicitly, so nothing depends on the host's time zone and
// tests can pass fixed dates. The owner's day is America/Lima (src/lib/time.ts).
import { ownerDateKey } from "@/lib/time";
import type { ProjectStatus } from "./project-constants";

/** States that show a due-date notice. Maintenance has no end; done and canceled are over. */
const STATUSES_WITH_DUE: ReadonlySet<ProjectStatus> = new Set(["idea", "active", "paused"]);

/** "Vence en N días" only up to a week ahead. */
export const DUE_SOON_DAYS = 7;

export type DueState =
  | { kind: "today"; days: 0; label: string }
  | { kind: "soon"; days: number; label: string }
  | { kind: "overdue"; days: number; label: string };

const DAY_MS = 86_400_000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since the epoch of a YYYY-MM-DD calendar day (no time zone involved). */
function dayNumber(key: string): number {
  const match = DATE_KEY.exec(key);
  if (!match) throw new Error(`Invalid date key: ${key}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

/** Whole days from Lima's today to `dueDate` (negative when it already passed). */
export function daysUntil(dueDate: string, now: Date): number {
  return dayNumber(dueDate) - dayNumber(ownerDateKey(now));
}

const days = (n: number) => (n === 1 ? "1 día" : `${n} días`);

/**
 * The due-date notice of a project, by Lima's calendar day: "Vence hoy", "Vence en N días" (up
 * to 7) or "Vencido hace N días". Null when there is nothing to say: no due date, more than a
 * week ahead, or a state without due notices (maintenance, done, canceled).
 */
export function dueState(
  dueDate: string | null,
  status: ProjectStatus,
  now: Date,
): DueState | null {
  if (dueDate === null || !STATUSES_WITH_DUE.has(status)) return null;
  const left = daysUntil(dueDate, now);
  if (left === 0) return { kind: "today", days: 0, label: "Vence hoy" };
  if (left < 0) return { kind: "overdue", days: -left, label: `Vencido hace ${days(-left)}` };
  if (left <= DUE_SOON_DAYS) return { kind: "soon", days: left, label: `Vence en ${days(left)}` };
  return null;
}
