// What `health` offers other modules (E4, SPEC-health "Contratos"). Only `today` and
// `weekly-review` may import it (eslint.config.mjs; `today` also reaches the routes and the
// «Entreno» card, `components/training-today`). Server only: every read checks the owner.
import "server-only";
import { and, gte, isNotNull, isNull, lt } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { selectCheckHabitOpenToday } from "@/modules/habits/contracts";
import { healthSessions } from "./db/schema";
import { selectNewRecordCounts } from "./records-data";
import { selectOpenSession, selectRotationRoutines } from "./sessions";
import { selectSettingsRow } from "./settings";
import {
  buildTodaySummary,
  limaWeekBounds,
  type HealthTodaySummary,
  type HealthWeekReview,
} from "./today-summary";

export type { HealthTodaySummary, HealthWeekReview } from "./today-summary";

/**
 * Hoy's «Entreno» (SPEC-health "Hoy"): the open session, the routine the rotation says and whether
 * the linked habit is due today (Lima's day of `now`) and not done. Three reads, plus the habit's
 * when one is linked and no session is open. Checks the owner.
 */
export async function getHealthTodaySummary(now: Date): Promise<HealthTodaySummary> {
  await requireOwner();
  const db = getDb();
  const [open, routines, settings] = await Promise.all([
    selectOpenSession(db),
    selectRotationRoutines(db),
    selectSettingsRow(db),
  ]);
  // With a session open the card is «Entreno en curso» whatever the habit says; without a live
  // routine there is nothing to start, so the habit isn't read either.
  const habitDue =
    open === null && routines.length > 0 && settings?.habitId
      ? await selectCheckHabitOpenToday(db, settings.habitId, now)
      : false;
  return buildTodaySummary(open, routines, habitDue);
}

/**
 * The weekly review's «Entreno» (SPEC-health "Revisión semanal"): the finished, live sessions that
 * started in the Lima week of `weekStart` (any day of it reads that week) and the new records set
 * in them. A malformed day reads nothing (zeros). Two queries (one without sessions). Checks the
 * owner.
 */
export async function getHealthWeekReview(weekStart: string): Promise<HealthWeekReview> {
  await requireOwner();
  const bounds = limaWeekBounds(weekStart);
  if (!bounds) return { sessions: 0, records: 0 };
  const db = getDb();
  const rows = await db
    .select({ id: healthSessions.id })
    .from(healthSessions)
    .where(
      and(
        isNull(healthSessions.deletedAt),
        isNotNull(healthSessions.endedAt),
        gte(healthSessions.startedAt, bounds.from),
        lt(healthSessions.startedAt, bounds.to),
      ),
    );
  const counts = await selectNewRecordCounts(
    db,
    rows.map((row) => row.id),
  );
  let records = 0;
  for (const count of counts.values()) records += count;
  return { sessions: rows.length, records };
}
