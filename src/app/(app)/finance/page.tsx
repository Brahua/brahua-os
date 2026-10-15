import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { getEmailSettings, listSuggestions } from "@/modules/finance/email/queries";
import { Cascade } from "@/lib/motion/cascade";
import { FinanceScreen } from "@/modules/finance/components/finance-screen";
import { SuggestionsSection } from "@/modules/finance/components/suggestions-section";
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
import { monthPoint } from "@/modules/finance/trend";
import { DELETED_PAYMENT_PARAM } from "@/modules/finance/payment-routes";
import {
  getFinanceCatalog,
  getMonthlyTotals,
  getPreviousMonthCumulative,
  listMonthExpenses,
} from "@/modules/finance/queries";
import {
  FINANCE_VIEW_COOKIE,
  MONTH_PARAM,
  parseFinanceSection,
  parseMonth,
} from "@/modules/finance/routes";

export const metadata: Metadata = { title: FINANCE_COPY.pageTitle };

type FinancePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Finanzas (SPEC-finance "Pantallas"): Resumen · Gastos · Pendientes · Pagados (the switch is remembered per device, in a
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
  const [
    catalog,
    expenses,
    trend,
    previousCumulative,
    payments,
    pending,
    deletedName,
    suggestions,
    emailSettings,
  ] = await Promise.all([
    getFinanceCatalog(),
    listMonthExpenses(month),
    // Six months for the comparison, each also up to today's day number ("same point").
    getMonthlyTotals(month, 6, monthPoint(month, today).day),
    getPreviousMonthCumulative(month),
    getPaymentsView(today),
    getPendingForMonth(month, today),
    typeof deletedId === "string" ? getDeletedRecurringName(deletedId) : null,
    // A secondary feature: if its tables fail, the month and the payments still load.
    listSuggestions().catch(() => []),
    getEmailSettings().catch(() => ({ ownNames: [], methods: [] })),
  ]);
  // Back from deleting a payment on its page: "Pagos", with its "Deshacer" notice.
  const section =
    deletedName !== null
      ? "pagos:pen"
      : parseFinanceSection((await cookies()).get(FINANCE_VIEW_COOKIE)?.value);

  return (
    <FinanceScreen today={today} catalog={catalog} emailSettings={emailSettings}>
      {/* Bottom padding grows with the notice (--toast-offset): a delete leaves a "Deshacer"
          notice, and the last row must stay reachable under it at full scroll. */}
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <Cascade index={0} className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="bo-text-display outline-none" tabIndex={-1} data-finance-title="">
            {FINANCE_COPY.title}
          </h1>
          <FinanceSettings />
        </Cascade>
        {/* SPEC-finance-email: the expenses found in the bank emails, above the month. */}
        <SuggestionsSection items={suggestions} />
        <FinanceViews
          initialSection={section}
          // The summary is computed from these rows on the client (summary.ts): no extra query.
          month={
            <MonthView
              month={month}
              expenses={expenses}
              pending={pending}
              trend={trend}
              previousCumulative={previousCumulative}
            />
          }
          payments={<PaymentsView data={payments} />}
        />
      </div>
      <PaymentsDeletedNotice
        deleted={deletedName !== null ? { id: String(deletedId), name: deletedName } : null}
      />
    </FinanceScreen>
  );
}
