// What `health` tells Hoy and the weekly review (E4, SPEC-health "Contratos"), pure and
// client-safe: the types the contracts return and the rules that build them from the reads.
import { nextRoutine, type RotationRoutine } from "./rotation";
import type { OpenSession } from "./sessions-input";

/** Hoy's «Entreno» (`getHealthTodaySummary`). */
export type HealthTodaySummary = {
  /** The open session: «Entreno en curso · Rutina A · 23 min» with «Seguir». */
  running: { id: string; routineName: string | null; startedAt: string } | null;
  /** The routine the rotation says («Empezar Rutina B»), or null without routines. */
  next: { routineId: string; routineName: string } | null;
  /** The linked habit is due today and not done yet (false without a linked habit). */
  habitDue: boolean;
};

/** The weekly review's «Entreno» (`getHealthWeekReview`). */
export type HealthWeekReview = {
  /** Finished, live sessions that started in the Lima week. */
  sessions: number;
  /** New records set in those sessions. */
  records: number;
};

/** The summary from its three reads (the open session, the rotation, the habit). */
export function buildTodaySummary(
  open: OpenSession | null,
  routines: readonly RotationRoutine[],
  habitDue: boolean,
): HealthTodaySummary {
  const next = nextRoutine(routines);
  return {
    running: open
      ? { id: open.id, routineName: open.routineName, startedAt: open.startedAt }
      : null,
    next: next ? { routineId: next.id, routineName: next.name } : null,
    habitDue,
  };
}

/** What Hoy's «Entreno» shows: the running card, «Empezar <rutina>», or nothing. */
export type TrainingCard =
  | { kind: "running"; id: string; routineName: string | null; startedAt: string }
  | { kind: "start"; routineId: string; routineName: string }
  | null;

/**
 * SPEC-health "Hoy": with an open session, «Entreno en curso»; without one, «Empezar <la que toca>»
 * only while the linked habit is due today and not done and a routine exists; otherwise nothing
 * (the section doesn't show).
 */
export function trainingCard(summary: HealthTodaySummary): TrainingCard {
  if (summary.running) return { kind: "running", ...summary.running };
  if (summary.habitDue && summary.next) return { kind: "start", ...summary.next };
  return null;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * The Lima week of `day` (any day of it, YYYY-MM-DD) as instants: from its Monday 00:00 Lima
 * (UTC-5, no daylight saving) to the next Monday, excluded. Null for a malformed day.
 */
export function limaWeekBounds(day: string): { from: Date; to: Date } | null {
  if (!DAY_KEY.test(day)) return null;
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) return null;
  const weekday = new Date(midnight).getUTCDay();
  const monday = midnight - ((weekday + 6) % 7) * DAY_MS;
  // 00:00 in Lima is 05:00 UTC.
  const from = new Date(monday + 5 * 3_600_000);
  return { from, to: new Date(from.getTime() + 7 * DAY_MS) };
}
