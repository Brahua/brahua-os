// Reads of recurring payments for Server Components (F2). Each one checks the owner first.
import "server-only";
import { cache } from "react";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import type { PaymentsViewData, PendingForMonth } from "./payments-view";
import {
  selectDeletedRecurringName,
  selectPaymentsView,
  selectPendingForMonth,
  selectRecurringDetail,
  type RecurringDetail,
} from "./recurring";

export type { PendingForMonth } from "./payments-view";

/** A malformed id is a 404, not a database error. */
const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** The "Pagos" view of /finance for Lima's `today` (YYYY-MM-DD). */
export async function getPaymentsView(today: string): Promise<PaymentsViewData> {
  await requireOwner();
  return selectPaymentsView(getDb(), today);
}

/**
 * Contract for F3 ("Pendiente de pagar" in "Mes"): the pending periods of the active recurring
 * payments due in `month` (YYYY-MM), not older than the 60-day window, with no settlement:
 * `{ count, totalPenCents, unconvertedUsdCents, variableCount }`. USD amounts are converted with
 * the current rate of Ajustes (nothing was paid yet); without a rate they go to
 * `unconvertedUsdCents`; variable payments count but add nothing to the total. `today` defaults to
 * Lima's today now.
 */
export async function getPendingForMonth(
  month: string,
  today: string = ownerDateKey(new Date()),
): Promise<PendingForMonth> {
  await requireOwner();
  return selectPendingForMonth(getDb(), month, today);
}

/** A payment's page (visible, archived included), or null for a 404. */
// Cached per request: the page and its generateMetadata read it once.
export const getRecurringDetail = cache(
  async (id: string, today: string): Promise<RecurringDetail | null> => {
    await requireOwner();
    if (!isUuid(id)) return null;
    return selectRecurringDetail(getDb(), id, today);
  },
);

/** The name of a payment deleted from its page, while it is still deleted (its "Deshacer"). */
export async function getDeletedRecurringName(id: string): Promise<string | null> {
  await requireOwner();
  if (!isUuid(id)) return null;
  return selectDeletedRecurringName(getDb(), id);
}
