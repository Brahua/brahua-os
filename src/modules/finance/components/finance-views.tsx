"use client";

import { useState } from "react";
import { SegmentedControl } from "@/design-system";
import { FINANCE_COPY } from "../finance-copy";
import { financeViewCookie, type FinanceView } from "../routes";

type FinanceViewsProps = {
  /** The view the device remembers (cookie, read on the server: no flash on load). */
  initialView: FinanceView;
  /** "Mes": the month's expenses (F3 adds the summary). */
  month: React.ReactNode;
  /** "Pagos": F2 slot (the recurring payments). Empty until then. */
  payments: React.ReactNode;
};

/**
 * The "Mes · Pagos" switch of /finance (SPEC-finance "Pantallas"), remembered per device. Both
 * panels are rendered by the server; the switch only shows one (the other keeps its state).
 */
export function FinanceViews({ initialView, month, payments }: FinanceViewsProps) {
  const [view, setView] = useState<FinanceView>(initialView);
  return (
    <div className="flex flex-col gap-6">
      <SegmentedControl
        touch
        label={FINANCE_COPY.viewsLabel}
        options={[
          { value: "month", label: FINANCE_COPY.viewMonth },
          { value: "payments", label: FINANCE_COPY.viewPayments },
        ]}
        value={view}
        onValueChange={(next) => {
          setView(next);
          document.cookie = financeViewCookie(next, window.location.protocol === "https:");
        }}
        className="self-start"
      />
      <div
        role="tabpanel"
        aria-label={FINANCE_COPY.viewMonth}
        hidden={view !== "month"}
        data-finance-view="month"
        className="flex flex-col gap-6"
      >
        {month}
      </div>
      <div
        role="tabpanel"
        aria-label={FINANCE_COPY.viewPayments}
        hidden={view !== "payments"}
        data-finance-view="payments"
        className="flex flex-col gap-6"
      >
        {/* F2 slot (Pagos): pendientes, este mes, todos, archivados. */}
        {payments}
      </div>
    </div>
  );
}
