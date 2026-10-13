// Reads of `weekly-review` for Server Components. Each one checks the owner first (SPEC-core); the
// `select…` variants take the database and trust their caller (integration tests, the W3 domain).
//
// Slots left for the next slices (each page checks `requireOwner()` and reads through these and the
// providers' contracts, never the providers' internals):
//
// - W2 (steps 1 and 2): the page picks the week (`parseWeekParam(?semana=, now)` or
//   `defaultReviewWeek(now, await hasReview(previousMonday(currentWeekStart(now))))`) and reads
//   `getHabitsWeekSummary`, `getHabitsWeekCompleteDays`, `getTasksWeekReview`,
//   `getProjectsWeekReview` and `getGoalsWeekReview` and moves tasks with `moveTasksToDate` /
//   `undoMoveTasks` (`moveTargets` says where).
// - W3 (steps 3 and 4, close and history): `closeWeek` (domain, first lock
//   `(WEEKLY_REVIEW_ADVISORY_SPACE, hashtext(weekStart))`) and `setWeeklyObjectiveForWeek` for the
//   next week; "Semanas anteriores" reads `listClosedWeeks` and recomputes each week's numbers.
// - W4 (invitation): `getReviewInvite(now)` = `reviewInvite(now, await hasReview(inviteWeek))`.
import "server-only";
import { desc, eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
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
