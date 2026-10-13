// Reads of `weekly-review` for Server Components. Each one checks the owner first (SPEC-core); the
// `select…` variants take the database and trust their caller (integration tests, the W3 domain).
//
// Slots left for W4 (the invitation): `getReviewInvite(now)` = `reviewInvite(now, await
// hasReview(inviteWeek))`. The page picks the week with `parseWeekParam` / `defaultReviewWeek` and
// reads the providers' contracts; W3 closes through `closeWeek` (actions.ts, review.ts) and reads
// «Semanas anteriores» with `getPreviousWeeks`.
import "server-only";
import { desc, eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import { getHabitsWeeksOverview } from "@/modules/habits/contracts";
import { weeklyReviews } from "./db/schema";
import { isMonday } from "./week";

/** A closed week as the screens get it (never the whole row). */
export type ReviewRow = {
  weekStart: string;
  /** ISO instant the week was closed. */
  completedAt: string;
  note: string | null;
};

/** How many closed weeks "Semanas anteriores" lists (SPEC-weekly-review "Pantallas"). */
export const PREVIOUS_WEEKS_LIMIT = 12;

/** The review of the week starting `weekStart`, or null when it wasn't closed. Trusts its caller. */
export async function selectReviewRow(db: Database, weekStart: string): Promise<ReviewRow | null> {
  const [row] = await db.select().from(weeklyReviews).where(eq(weeklyReviews.weekStart, weekStart));
  return row
    ? { weekStart: row.weekStart, completedAt: row.completedAt.toISOString(), note: row.note }
    : null;
}

/** The closed weeks, the most recent first. Trusts its caller. */
export async function selectClosedWeeks(
  db: Database,
  limit: number = PREVIOUS_WEEKS_LIMIT,
): Promise<ReviewRow[]> {
  const rows = await db
    .select()
    .from(weeklyReviews)
    .orderBy(desc(weeklyReviews.weekStart))
    .limit(limit);
  return rows.map((row) => ({
    weekStart: row.weekStart,
    completedAt: row.completedAt.toISOString(),
    note: row.note,
  }));
}

/** The review of the week starting `weekStart` (a Monday), or null when not closed or malformed. */
export async function getReviewRow(weekStart: string): Promise<ReviewRow | null> {
  await requireOwner();
  // Not a Monday (a malformed value): no query.
  if (!isMonday(weekStart)) return null;
  return selectReviewRow(getDb(), weekStart);
}

/** Whether the week starting `weekStart` was closed. */
export async function hasReview(weekStart: string): Promise<boolean> {
  return (await getReviewRow(weekStart)) !== null;
}

/** The last closed weeks (default 12), the most recent first. */
export async function listClosedWeeks(limit: number = PREVIOUS_WEEKS_LIMIT): Promise<ReviewRow[]> {
  await requireOwner();
  return selectClosedWeeks(getDb(), Math.min(Math.max(Math.trunc(limit), 1), 52));
}

/** A closed week with the numbers «Semanas anteriores» shows (recomputed from that week's data). */
export type PreviousWeek = {
  weekStart: string;
  note: string | null;
  /** «Días completos: N». */
  completeDays: number;
  /** «N de M hábitos» (M is 0 when no habit counted that week). */
  habitsDone: number;
  habitsExpected: number;
};

/**
 * «Semanas anteriores»: the last closed weeks (12), the most recent first, each with its habits'
 * numbers recomputed from the data of that week (the live figure, SPEC "Números"). A fixed number
 * of queries whatever the count: the list and one batch of `habits`' contract. Tasks done are left
 * out (a batch would need a new contract in `tasks`; decisión autónoma para revisar con el owner).
 */
export async function getPreviousWeeks(now: Date = new Date()): Promise<PreviousWeek[]> {
  const closed = await listClosedWeeks(PREVIOUS_WEEKS_LIMIT);
  if (closed.length === 0) return [];
  const overview = await getHabitsWeeksOverview(
    closed.map((row) => row.weekStart),
    now,
  );
  return closed.map((row, index) => ({
    weekStart: row.weekStart,
    note: row.note,
    completeDays: overview[index]?.completeDays ?? 0,
    habitsDone: overview[index]?.done ?? 0,
    habitsExpected: overview[index]?.expected ?? 0,
  }));
}
