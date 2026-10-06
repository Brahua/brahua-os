"use client";

import { createContext, use, useCallback, useMemo, useRef } from "react";
import {
  ScreenServicesProvider,
  useRequiredScreenServices,
  type ScreenServices,
} from "@/modules/core/components/screen-services";
import type { FinanceCatalog } from "../catalog-input";
import { FINANCE_COPY } from "../finance-copy";

// ── Shared by every part of the finance screen (the month, the sheets, F2's Pagos, F3's summary) ──

type FinanceScreenData = {
  /** The Lima day the page was read for (YYYY-MM-DD): a new expense's date. */
  today: string;
  /** The catalog as the page read it (categories, methods, rate, last method). */
  catalog: FinanceCatalog;
};

/** Opens "Ajustes"; focus returns to `returnTo` when it closes (the header key without one). */
export type OpenSettings = (returnTo?: HTMLElement | null) => void;

type FinanceScreenContextValue = FinanceScreenData & {
  openSettings: OpenSettings;
  /** `FinanceSettings` (the header key) registers how to open its sheet; null when it unmounts. */
  registerSettings: (open: OpenSettings | null) => void;
};

export type FinanceScreenValue = FinanceScreenData &
  Pick<FinanceScreenContextValue, "openSettings"> &
  Pick<ScreenServices, "enqueue" | "toaster" | "announce">;

const FinanceScreenContext = createContext<FinanceScreenContextValue | null>(null);

/**
 * The screen's day and catalog, with its save queue, notices and announcer (one of each per
 * screen, from `ScreenServicesProvider`). Queue keys in use: `expense-delete:<id>` (delete and its
 * undo); F2: `payment-period:<id>:<due>` (pay, skip and their undo), `payment-archive:<id>`,
 * `payment-delete:<id>`. F3 uses its own and keeps its own useOptimistic;
 * call `enqueue` inside startTransition.
 */
export function useFinanceScreen(): FinanceScreenValue {
  const data = use(FinanceScreenContext);
  const { enqueue, toaster, announce } = useRequiredScreenServices();
  if (!data) throw new Error("useFinanceScreen must be used inside FinanceScreen");
  const { today, catalog, openSettings } = data;
  return { today, catalog, openSettings, enqueue, toaster, announce };
}

/** For `FinanceSettings` only: registers the opener of its sheet (F3's "Fijar tipo de cambio"). */
export function useRegisterSettings(): (open: OpenSettings | null) => void {
  const data = use(FinanceScreenContext);
  if (!data) throw new Error("useRegisterSettings must be used inside FinanceScreen");
  return data.registerSettings;
}

type FinanceScreenProps = FinanceScreenData & { children: React.ReactNode };

/**
 * Wraps /finance: one save queue, one notice viewport and one polite announcer for everything on
 * it. It watches Lima's day: left open past midnight, the page is read again (today moves on).
 */
export function FinanceScreen({ today, catalog, children }: FinanceScreenProps) {
  const settings = useRef<OpenSettings | null>(null);
  const registerSettings = useCallback((open: OpenSettings | null) => {
    settings.current = open;
  }, []);
  const openSettings = useCallback<OpenSettings>((returnTo) => settings.current?.(returnTo), []);
  const value = useMemo(
    () => ({ today, catalog, openSettings, registerSettings }),
    [today, catalog, openSettings, registerSettings],
  );
  return (
    <ScreenServicesProvider
      label={FINANCE_COPY.noticesLabel}
      actionHint={FINANCE_COPY.undoHint}
      day={{ today, changedMessage: FINANCE_COPY.newDay }}
    >
      <FinanceScreenContext value={value}>{children}</FinanceScreenContext>
    </ScreenServicesProvider>
  );
}
