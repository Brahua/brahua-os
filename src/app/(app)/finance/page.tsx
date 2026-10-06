import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { FinanceScreen } from "@/modules/finance/components/finance-screen";
import { FinanceViews } from "@/modules/finance/components/finance-views";
import { MonthView } from "@/modules/finance/components/month-view";
import { PaymentsDeletedNotice } from "@/modules/finance/components/payments-deleted-notice";
import { PaymentsView } from "@/modules/finance/components/payments-view";
import { FinanceSettings } from "@/modules/finance/components/settings-sheet";
import { FINANCE_COPY } from "@/modules/finance/finance-copy";
import {
  getDeletedRecurringName,
  getPaymentsView,
  getPendingForMonth,
} from "@/modules/finance/payment-queries";
import { DELETED_PAYMENT_PARAM } from "@/modules/finance/payment-routes";
import { getFinanceCatalog, listMonthExpenses } from "@/modules/finance/queries";
import {
  FINANCE_VIEW_COOKIE,
  MONTH_PARAM,
  parseFinanceView,
  parseMonth,
} from "@/modules/finance/routes";

export const metadata: Metadata = { title: FINANCE_COPY.pageTitle };

type FinancePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Finanzas (SPEC-finance "Pantallas"): "Mes · Pagos" (the switch is remembered per device, in a
 * cookie read here so the first paint is right) and "Ajustes" in the header. "Mes": the month's
 * expenses with its summary, arrows and "Pendiente de pagar" (F3); "Pagos": the recurring
 * payments (F2).
 */
export default async function FinancePage({ searchParams }: FinancePageProps) {
  await requireOwner();
  const search = await searchParams;
  // One instant for the whole page.
  const today = ownerDateKey(new Date());
  const month = parseMonth(search[MONTH_PARAM], today.slice(0, 7));
  const deletedId = search[DELETED_PAYMENT_PARAM];
  const [catalog, expenses, payments, pending, deletedName] = await Promise.all([
    getFinanceCatalog(),
    listMonthExpenses(month),
    getPaymentsView(today),
    getPendingForMonth(month, today),
    typeof deletedId === "string" ? getDeletedRecurringName(deletedId) : null,
  ]);
  // Back from deleting a payment on its page: "Pagos", with its "Deshacer" notice.
  const view =
    deletedName !== null
      ? "payments"
      : parseFinanceView((await cookies()).get(FINANCE_VIEW_COOKIE)?.value);

  return (
    <FinanceScreen today={today} catalog={catalog}>
      {/* Bottom padding grows with the notice (--toast-offset): a delete leaves a "Deshacer"
          notice, and the last row must stay reachable under it at full scroll. */}
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="bo-text-display">{FINANCE_COPY.title}</h1>
          <FinanceSettings />
        </div>
        <FinanceViews
          initialView={view}
          // The summary is computed from these rows on the client (summary.ts): no extra query.
          month={<MonthView month={month} expenses={expenses} pending={pending} />}
          payments={<PaymentsView data={payments} />}
        />
      </div>
      <PaymentsDeletedNotice
        deleted={deletedName !== null ? { id: String(deletedId), name: deletedName } : null}
      />
    </FinanceScreen>
  );
}
