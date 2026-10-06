import { Wallet } from "lucide-react";
import Link from "next/link";
import { Icon, Key } from "@/design-system";
import { StatusScreen } from "@/modules/core/components/status-screen";
import { PAYMENTS_COPY } from "@/modules/finance/payments-copy";
import { FINANCE_PATH } from "@/modules/finance/routes";

/**
 * A recurring payment that doesn't exist, has a malformed id or was deleted: inside the shell,
 * back to Finanzas. Its title and `noindex` come from the page's generateMetadata.
 */
export default function PaymentNotFound() {
  return (
    <StatusScreen
      lcdTag="404"
      lcdText={PAYMENTS_COPY.notFoundLcd}
      heading={PAYMENTS_COPY.notFoundHeading}
      description={PAYMENTS_COPY.notFoundText}
    >
      <Key asChild variant="signal">
        <Link href={FINANCE_PATH}>
          <Icon icon={Wallet} />
          {PAYMENTS_COPY.backToPayments}
        </Link>
      </Key>
    </StatusScreen>
  );
}
