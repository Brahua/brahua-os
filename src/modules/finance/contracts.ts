// What `finance` offers other modules (F4, SPEC-finance "Contratos"), server-only:
//
// getFinanceTodaySummary(now) (for `today`): the pending periods of the active recurring
// payments, overdue up to 60 days or due within the next 7 (Lima), by due date: the same list as
// "Pendientes" of "Pagos" (F2's `schedule.ts` through `pendingPeriodsOf`, never a copy of its
// rules), in two parallel queries.
//
// `today` pays from its rows with `paymentCompletion` (`markPaid` / `undoPaid`) and draws them
// with `PaymentTodayRow` and `TodayPaySheet` (components/), through the host's screen services.
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { selectPendingPeriods } from "./recurring";
import { toFinanceTodayItems, type FinanceTodayItem } from "./today-summary";

export type { FinanceTodayItem } from "./today-summary";

/** The summary's rows (two queries). Trusts its caller (see getFinanceTodaySummary). */
export async function selectFinanceTodaySummary(
  db: Database,
  now: Date,
): Promise<FinanceTodayItem[]> {
  return toFinanceTodayItems(await selectPendingPeriods(db, ownerDateKey(now)));
}

/**
 * The home page's "Pagos": every pending period of an active (not archived, not deleted)
 * recurring payment, due from 60 days before Lima's day of `now` to 7 days after it (both
 * included), with no settlement (paid or skipped), by due date then name. Two queries.
 */
export async function getFinanceTodaySummary(now: Date): Promise<FinanceTodayItem[]> {
  await requireOwner();
  return selectFinanceTodaySummary(getDb(), now);
}
