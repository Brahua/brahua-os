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
import { Cascade, useCrossFade } from "@/lib/motion";
import { FINANCE_COPY } from "../finance-copy";
import { financeViewCookie, FINANCE_SECTIONS, type FinanceSection } from "../routes";

type FinanceViewsValue = {
  /** The section being shown. */
  section: FinanceSection;
  /** Shows a section as its tab would (remembered too) and moves focus to its tab. */
  showSection: (section: FinanceSection) => void;
  /** The ids, ref and visibility of a section's panel (`ViewPanel` applies them). */
  panelFor: (section: FinanceSection) => {
    id: string;
    labelledBy: string;
    hidden: boolean;
    ref: (element: HTMLElement | null) => void;
  };
};

const FinanceViewsContext = createContext<FinanceViewsValue | null>(null);

/** The section switch, for links inside a panel; null outside `FinanceViews`. */
export function useFinanceViews(): FinanceViewsValue | null {
  return use(FinanceViewsContext);
}

const SECTION_LABEL: Record<FinanceSection, string> = {
  "mes:res": FINANCE_COPY.sectionSummary,
  "mes:gas": FINANCE_COPY.sectionExpenses,
  "pagos:pen": FINANCE_COPY.sectionPending,
  "pagos:pag": FINANCE_COPY.sectionPaid,
};

/**
 * One section's panel. Under `FinanceViews` it is a tab panel that shows only when its tab is
 * chosen (the others stay mounted and keep their state); on its own (tests, other screens) it is
 * a plain visible block.
 */
export function ViewPanel({
  section,
  className,
  children,
}: {
  section: FinanceSection;
  className?: string;
  children: React.ReactNode;
}) {
  const views = useFinanceViews();
  const panel = views?.panelFor(section);
  return (
    <div
      ref={panel?.ref}
      id={panel?.id}
      role="tabpanel"
      aria-labelledby={panel?.labelledBy}
      // Until the effect ties the tab (and in tests before it runs), a name of its own.
      aria-label={SECTION_LABEL[section]}
      hidden={panel?.hidden}
      data-finance-view={section}
      className={className ?? "flex flex-col gap-6"}
    >
      {children}
    </div>
  );
}

type FinanceViewsProps = {
  /** The section the device remembers (cookie, read on the server: no flash on load). */
  initialSection: FinanceSection;
  /** The month's section («Resumen» and «Gastos») and the payments' («Pendientes» and «Pagados»):
   *  each renders its own two `ViewPanel`s, since each pair shares state. */
  month: React.ReactNode;
  payments: React.ReactNode;
};

/**
 * The four sections of /finance — Resumen · Gastos under "Mes", Pendientes · Pagados under
 * "Pagos" — remembered per device. Every panel is rendered by the server; the switch only shows one.
 */
export function FinanceViews({ initialSection, month, payments }: FinanceViewsProps) {
  const [section, setSection] = useState<FinanceSection>(initialSection);
  const ids = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const panel = useCrossFade(section);
  const tabId = (value: FinanceSection) => `${ids}-tab-${value}`;
  const panelId = (value: FinanceSection) => `${ids}-panel-${value}`;
  // A section shown from inside a panel (the summary's cards): its tab takes focus once shown.
  const focusTab = useRef<FinanceSection | null>(null);

  const choose = useCallback((next: FinanceSection) => {
    setSection(next);
    document.cookie = financeViewCookie(next, window.location.protocol === "https:");
  }, []);
  const switcher = useMemo<FinanceViewsValue>(
    () => ({
      section,
      showSection: (next) => {
        focusTab.current = next;
        choose(next);
      },
      panelFor: (value) => ({
        id: panelId(value),
        labelledBy: tabId(value),
        hidden: section !== value,
        ref: panel(value),
      }),
    }),
    // `panel` and the id helpers are recreated each render but only read `section` and `ids`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section, choose, ids],
  );

  useEffect(() => {
    const target = focusTab.current;
    if (target === null || target !== section) return;
    focusTab.current = null;
    tabs.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [FINANCE_SECTIONS.indexOf(target)]?.focus();
  }, [section]);

  // The design system's SegmentedControl has no per-option ids: tie each tab to its panel here
  // (tabs in FINANCE_SECTIONS order), so each panel is named by its tab and the tab controls it.
  useEffect(() => {
    const buttons = tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [];
    buttons.forEach((button, index) => {
      const value = FINANCE_SECTIONS[index];
      if (!value) return;
      button.id = tabId(value);
      button.setAttribute("aria-controls", panelId(value));
    });
  });

  return (
    <div className="flex flex-col gap-6">
      <Cascade index={1} className="self-start">
        <div ref={tabs} data-finance-sections="">
          <SegmentedControl
            touch
            label={FINANCE_COPY.viewsLabel}
            options={FINANCE_SECTIONS.map((value) => ({ value, label: SECTION_LABEL[value] }))}
            value={section}
            onValueChange={choose}
          />
        </div>
      </Cascade>
      <FinanceViewsContext value={switcher}>
        {month}
        {payments}
      </FinanceViewsContext>
    </div>
  );
}
