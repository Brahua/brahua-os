import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { FinanceScreen } from "@/modules/finance/components/finance-screen";
import { RecurringDetail } from "@/modules/finance/components/recurring-detail";
import { getRecurringDetail } from "@/modules/finance/payment-queries";
import { PAYMENTS_COPY } from "@/modules/finance/payments-copy";
import { getFinanceCatalog } from "@/modules/finance/queries";
import { FINANCE_PATH } from "@/modules/finance/routes";

type PaymentPageProps = { params: Promise<{ id: string }> };

const HEADING_ID = "payment-title";

export async function generateMetadata({ params }: PaymentPageProps): Promise<Metadata> {
  const { id } = await params;
  const loaded = await getRecurringDetail(id, ownerDateKey(new Date()));
  // The page's metadata also applies to its not-found.tsx (which can't set its own here).
  if (!loaded) {
    return { title: PAYMENTS_COPY.notFoundTitle, robots: { index: false, follow: false } };
  }
  return { title: PAYMENTS_COPY.pageTitle(loaded.item.name) };
}

/**
 * A recurring payment's page (SPEC-finance "/finance/payments/[id]"): its data, next 3 due dates,
 * the history of its periods and its actions. Archived payments have one too. Missing, deleted or
 * malformed ids are a 404.
 */
export default async function PaymentPage({ params }: PaymentPageProps) {
  await requireOwner();
  const { id } = await params;
  // One instant for the whole page.
  const today = ownerDateKey(new Date());
  const [loaded, catalog] = await Promise.all([getRecurringDetail(id, today), getFinanceCatalog()]);
  if (!loaded) notFound();

  return (
    <FinanceScreen today={today} catalog={catalog}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <Link
          href={FINANCE_PATH}
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {PAYMENTS_COPY.backToPayments}
        </Link>
        <RecurringDetail
          item={loaded.item}
          nextDues={loaded.nextDues}
          history={loaded.history}
          headingId={HEADING_ID}
        />
      </div>
    </FinanceScreen>
  );
}
