// The close of a week (server only; SPEC-weekly-review "Modelo de datos"). These functions take the
// database and trust their input: the action checks the owner and validates first
// (review-input.ts), and the clock check (`isReviewableWeek`) is the action's too.
//
// Lock: `(6000, hashtext(<week_start>))`, the FIRST lock of the transaction (CLAUDE.md "Advisory
// locks": two keys, never after a row lock). Two closes of the same week wait for each other and
// end with one row (the last note wins); different weeks never wait. The close never holds this lock
// while it calls another domain: the next week's objective is `goals`' own transaction and lock
// (`setWeeklyObjectiveForWeek`), done BEFORE this one, each atomic, so repeating the whole close
// is safe at any point.
import "server-only";
import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { weeklyReviews } from "./db/schema";
import { WEEKLY_REVIEW_ADVISORY_SPACE, weeklyReviewKey } from "./lock-keys";
import type { ReviewRow } from "./queries";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The week's lock. Must be the first lock of the transaction. */
function lockWeek(tx: Tx, weekStart: string) {
  return tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(WEEKLY_REVIEW_ADVISORY_SPACE))}, hashtext(${weeklyReviewKey(weekStart)}))`,
  );
}

/**
 * Closes the week starting `weekStart` (a Monday): inserts its row, or on a repeat updates only the
 * note (`completed_at` is set once, the first time: re-closing never moves it). `note` null clears
 * the note. Idempotent; returns the row as it stands.
 */
export async function closeWeekRow(
  db: Database,
  { weekStart, note }: { weekStart: string; note: string | null },
  now: Date = new Date(),
): Promise<ReviewRow> {
  return db.transaction(async (tx) => {
    await lockWeek(tx, weekStart);
    const [row] = await tx
      .insert(weeklyReviews)
      .values({ weekStart, completedAt: now, note })
      .onConflictDoUpdate({
        target: weeklyReviews.weekStart,
        // completed_at is not in the update: the first close stays. (`coalesce` of the stored value
        // would be the same; leaving it out says it plainly.)
        set: { note, updatedAt: sql`now()` },
      })
      .returning();
    return {
      weekStart: row.weekStart,
      completedAt: row.completedAt.toISOString(),
      note: row.note,
    };
  });
}
