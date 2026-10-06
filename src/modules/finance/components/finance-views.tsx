"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { SegmentedControl } from "@/design-system";
import { FINANCE_COPY } from "../finance-copy";
import { financeViewCookie, FINANCE_VIEWS, type FinanceView } from "../routes";

type FinanceViewsValue = {
  /** Shows a view as its tab would (remembered too) and moves focus to its tab. */
  showView: (view: FinanceView) => void;
};

const FinanceViewsContext = createContext<FinanceViewsValue | null>(null);

/** The "Mes · Pagos" switch, for links inside a panel; null outside `FinanceViews`. */
export function useFinanceViews(): FinanceViewsValue | null {
  return use(FinanceViewsContext);
}

type FinanceViewsProps = {
  /** The view the device remembers (cookie, read on the server: no flash on load). */
  initialView: FinanceView;
  /** "Mes": the month's expenses (F3 adds the summary). */
  month: React.ReactNode;
  /** "Pagos": the recurring payments (F2). */
  payments: React.ReactNode;
};

/**
 * The "Mes · Pagos" switch of /finance (SPEC-finance "Pantallas"), remembered per device. Both
 * panels are rendered by the server; the switch only shows one (the other keeps its state).
 */
export function FinanceViews({ initialView, month, payments }: FinanceViewsProps) {
  const [view, setView] = useState<FinanceView>(initialView);
  const ids = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const tabId = (value: FinanceView) => `${ids}-tab-${value}`;
  const panelId = (value: FinanceView) => `${ids}-panel-${value}`;
  // A view shown from inside a panel (F3's "Pendiente de pagar"): its tab takes focus once shown.
  const focusTab = useRef<FinanceView | null>(null);

  const choose = useCallback((next: FinanceView) => {
    setView(next);
    document.cookie = financeViewCookie(next, window.location.protocol === "https:");
  }, []);
  const switcher = useMemo(
    () => ({
      showView: (next: FinanceView) => {
        focusTab.current = next;
        choose(next);
      },
    }),
    [choose],
  );

  useEffect(() => {
    const target = focusTab.current;
    if (target === null || target !== view) return;
    focusTab.current = null;
    tabs.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [FINANCE_VIEWS.indexOf(target)]?.focus();
  }, [view]);

  // The design system's SegmentedControl has no per-option ids: tie each tab to its panel here
  // (tabs in FINANCE_VIEWS order), so each panel is named by its tab and the tab controls it.
  useEffect(() => {
    const buttons = tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [];
    buttons.forEach((button, index) => {
      const value = FINANCE_VIEWS[index];
      if (!value) return;
      button.id = tabId(value);
      button.setAttribute("aria-controls", panelId(value));
    });
  });

  return (
    <div className="flex flex-col gap-6">
      <div ref={tabs} className="self-start">
        <SegmentedControl
          touch
          label={FINANCE_COPY.viewsLabel}
          options={FINANCE_VIEWS.map((value) => ({
            value,
            label: value === "month" ? FINANCE_COPY.viewMonth : FINANCE_COPY.viewPayments,
          }))}
          value={view}
          onValueChange={choose}
        />
      </div>
      <FinanceViewsContext value={switcher}>
        {FINANCE_VIEWS.map((value) => (
          <div
            key={value}
            id={panelId(value)}
            role="tabpanel"
            aria-labelledby={tabId(value)}
            // Until the effect ties the tab (and in tests before it runs), a name of its own.
            aria-label={value === "month" ? FINANCE_COPY.viewMonth : FINANCE_COPY.viewPayments}
            hidden={view !== value}
            data-finance-view={value}
            className="flex flex-col gap-6"
          >
            {value === "month" ? month : payments}
          </div>
        ))}
      </FinanceViewsContext>
    </div>
  );
}
