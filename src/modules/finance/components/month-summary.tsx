"use client";

// The month's summary of "Mes" (F3, SPEC-finance "Resumen"): the total with its arrows, "+ USD …
// sin convertir", the "Pendiente de pagar" strip and the blocks (by category, by payment method,
// recurring and one-off). Only the data: no comparisons, no guilt, no red.
import NumberFlow from "@number-flow/react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useId } from "react";
import { Icon, IconKey, Key } from "@/design-system";
import { cn } from "@/lib/cn";
import { formatMoney, spokenMoney } from "../money";
import type { MonthPending, MonthSummary, MoneyTotal, SummaryGroup } from "../summary";
import { groupKey } from "../summary";
import { moneyTotalText, percentText, spokenTotal, SUMMARY_COPY } from "../summary-copy";
import { useFinanceViews } from "./finance-views";

// ── Header ──────────────────────────────────────────────────────────────────────────────────────

type MonthArrowProps = {
  direction: "previous" | "next";
  /** The month it goes to (its title), or null when there is none (current month, or 2000-01). */
  targetTitle: string | null;
  onGo: () => void;
};

/**
 * An arrow of the month's header. With nowhere to go it stays focusable but `aria-disabled` (the
 * arrow that brought the current month keeps focus, CLAUDE.md "Focus").
 */
export function MonthArrow({ direction, targetTitle, onGo }: MonthArrowProps) {
  const disabled = targetTitle === null;
  const label =
    direction === "previous"
      ? disabled
        ? SUMMARY_COPY.noPreviousMonth
        : SUMMARY_COPY.previousMonth(targetTitle)
      : disabled
        ? SUMMARY_COPY.noNextMonth
        : SUMMARY_COPY.nextMonth(targetTitle);
  return (
    <IconKey
      variant="ghost"
      icon={direction === "previous" ? ChevronLeft : ChevronRight}
      label={label}
      // No tooltip: its long name would stick out past a 320 px screen; the chevrons say it.
      tooltip={false}
      aria-disabled={disabled || undefined}
      className={cn("bo-month-arrow", disabled && "is-disabled")}
      data-month-arrow={direction}
      onClick={() => {
        if (!disabled) onGo();
      }}
    />
  );
}

type MonthTotalProps = {
  total: MoneyTotal;
  /** Whether a rate is set in Ajustes: without one, "Fijar tipo de cambio" opens it. */
  rateSet: boolean;
  onSetRate: (opener: HTMLElement) => void;
};

/**
 * The month's total in PEN with `NumberFlow` (digits roll when it changes; never with reduced
 * motion), and the USD without a rate apart. Screen readers get one string: "Total del mes: 9,820
 * soles" (NumberFlow exposes each digit separately, so the animation is hidden from them).
 */
export function MonthTotal({ total, rateSet, onSetRate }: MonthTotalProps) {
  return (
    <div className="flex flex-col gap-2" data-month-total={total.penCents}>
      <p className="bo-stat bo-month-total">
        <span className="bo-stat__value" aria-hidden>
          <NumberFlow
            value={total.penCents / 100}
            locales="es-PE"
            format={{
              style: "currency",
              currency: "PEN",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }}
            respectMotionPreference
          />
        </span>
        <span className="bo-stat__label" aria-hidden>
          {SUMMARY_COPY.totalLabel}
        </span>
        <span className="sr-only">{`${SUMMARY_COPY.totalLabel}: ${spokenMoney(total.penCents, "PEN")}`}</span>
      </p>
      {total.unconvertedUsdCents > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-month-unconverted="">
          <p className="bo-text-body-sm text-text-secondary">
            <span className="bo-amount" aria-hidden>
              {SUMMARY_COPY.unconverted(formatMoney(total.unconvertedUsdCents, "USD"))}
            </span>
            <span className="sr-only">
              {SUMMARY_COPY.unconvertedSpoken(spokenMoney(total.unconvertedUsdCents, "USD"))}
            </span>
          </p>
          {rateSet ? null : (
            <Key
              variant="ghost"
              size="sm"
              aria-haspopup="dialog"
              onClick={(event) => onSetRate(event.currentTarget)}
            >
              {SUMMARY_COPY.setRate}
            </Key>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── "Pendiente de pagar" ────────────────────────────────────────────────────────────────────────

/**
 * "Pendiente de pagar: S/ 1,250.00 · 2 pagos" (F2's recurring payments still due this month); it
 * shows Pagos. Nothing when there is nothing pending (or F2's data isn't wired: null).
 */
export function PendingStrip({ pending }: { pending: MonthPending | null }) {
  const views = useFinanceViews();
  if (!pending || pending.count === 0) return null;
  const amount = moneyTotalText(pending.totalPenCents, pending.unconvertedUsdCents);
  const spoken = spokenTotal(pending.totalPenCents, pending.unconvertedUsdCents);
  return (
    <ul className="bo-list" aria-label={SUMMARY_COPY.pendingTitle} data-month-pending="">
      <li>
        <button
          type="button"
          className="bo-row"
          aria-label={SUMMARY_COPY.pendingLabel(spoken, pending.count)}
          onClick={() => views?.showView("payments")}
        >
          <span className="bo-row__body" aria-hidden>
            <span className="bo-row__title">{SUMMARY_COPY.pendingTitle}</span>
            <span className="bo-row__subtitle">{SUMMARY_COPY.pendingCount(pending.count)}</span>
          </span>
          <span className="bo-row__trail" aria-hidden>
            <span className="bo-amount bo-text-body text-text">{amount}</span>
            <Icon icon={ChevronRight} size="sm" />
          </span>
        </button>
      </li>
    </ul>
  );
}

// ── Blocks ──────────────────────────────────────────────────────────────────────────────────────

const groupName = (group: SummaryGroup, none: string) => group.name ?? none;

/** "Comida, 1,250 soles, 58 por ciento" (plus ", y 95 dólares sin convertir"). */
function spokenGroup(group: SummaryGroup, none: string): string {
  const parts = [groupName(group, none), spokenTotal(group.penCents, group.unconvertedUsdCents)];
  const percent = SUMMARY_COPY.spokenPercent(group.percent);
  if (percent) parts.push(percent);
  return parts.join(", ");
}

type CategoryBarsProps = {
  categories: SummaryGroup[];
  /** The category the list is filtered by ("none" for "Sin categoría"), if any. */
  activeKey: string | null;
  onToggle: (group: SummaryGroup) => void;
  /** Each bar's key, to bring focus back to it after "Quitar filtro". */
  registerBar: (key: string, element: HTMLButtonElement | null) => void;
  headingRef: React.Ref<HTMLHeadingElement>;
};

/**
 * "Por categoría": one row per category with its name, amount and percentage over a horizontal
 * CSS bar (decorative: the row's name says it all). Each row is a toggle that filters the list.
 */
export function CategoryBars({
  categories,
  activeKey,
  onToggle,
  registerBar,
  headingRef,
}: CategoryBarsProps) {
  const ids = useId();
  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3
          ref={headingRef}
          id={`${ids}-heading`}
          tabIndex={-1}
          className="bo-text-subheading outline-none"
        >
          {SUMMARY_COPY.byCategory}
        </h3>
        <p id={`${ids}-hint`} className="bo-text-body-sm text-text-secondary">
          {SUMMARY_COPY.categoryHint}
        </p>
      </div>
      <ul className="bo-list" aria-labelledby={`${ids}-heading`} aria-describedby={`${ids}-hint`}>
        {categories.map((group) => {
          const key = groupKey(group);
          const pressed = activeKey === key;
          const percent = percentText(group.percent);
          return (
            <li key={key}>
              <button
                ref={(element) => registerBar(key, element)}
                type="button"
                aria-pressed={pressed}
                aria-label={spokenGroup(group, SUMMARY_COPY.uncategorized)}
                onClick={() => onToggle(group)}
                className="bo-row bo-summary-row"
                data-category-bar={key}
              >
                <span className="bo-summary-row__line" aria-hidden>
                  <span className="bo-row__title flex min-w-0 items-center gap-1.5">
                    {pressed ? <Icon icon={Check} size="sm" /> : null}
                    <span className="truncate">{groupName(group, SUMMARY_COPY.uncategorized)}</span>
                  </span>
                  <span className="bo-summary-row__figures">
                    <span className="bo-amount bo-text-body text-text">
                      {formatMoney(group.penCents, "PEN")}
                    </span>
                    {percent ? (
                      <span className="bo-amount bo-text-body-sm bo-summary-row__percent">
                        {percent}
                      </span>
                    ) : null}
                  </span>
                </span>
                {group.unconvertedUsdCents > 0 ? (
                  <span className="bo-amount bo-text-body-sm text-text-secondary" aria-hidden>
                    {SUMMARY_COPY.unconverted(formatMoney(group.unconvertedUsdCents, "USD"))}
                  </span>
                ) : null}
                <span className="bo-summary-bar" aria-hidden>
                  <span
                    className="bo-summary-bar__fill"
                    style={{ width: `${(group.share * 100).toFixed(2)}%` }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "Por medio de pago": compact rows with each method's amount (read-only). */
export function MethodRows({ methods }: { methods: SummaryGroup[] }) {
  const ids = useId();
  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-3">
      <h3 id={`${ids}-heading`} className="bo-text-subheading">
        {SUMMARY_COPY.byMethod}
      </h3>
      <ul className="bo-list" aria-labelledby={`${ids}-heading`}>
        {methods.map((group) => (
          <li key={groupKey(group)} className="bo-row bo-row--compact bo-row--static py-2">
            <span className="sr-only">
              {spokenGroup({ ...group, percent: null }, SUMMARY_COPY.noMethod)}
            </span>
            <span className="bo-row__title min-w-0 flex-1 truncate" aria-hidden>
              {groupName(group, SUMMARY_COPY.noMethod)}
            </span>
            {/* The USD without a rate goes on a line of its own: the name keeps its room. */}
            <span
              className="flex max-w-[65%] min-w-0 flex-col items-end text-right [overflow-wrap:anywhere]"
              aria-hidden
            >
              <span className="bo-amount bo-text-body-sm text-text">
                {formatMoney(group.penCents, "PEN")}
              </span>
              {group.unconvertedUsdCents > 0 ? (
                <span className="bo-amount bo-text-body-sm text-text-secondary">
                  {SUMMARY_COPY.unconverted(formatMoney(group.unconvertedUsdCents, "USD"))}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Recurrente y suelto": what paid recurring payments and what didn't, side by side. */
export function RecurringSplit({ summary }: { summary: MonthSummary }) {
  const ids = useId();
  const total = summary.total.penCents;
  const parts = [
    { label: SUMMARY_COPY.recurring, value: summary.recurring, tone: "recurring" },
    { label: SUMMARY_COPY.oneOff, value: summary.oneOff, tone: "one-off" },
  ] as const;
  return (
    <section aria-labelledby={`${ids}-heading`} className="flex flex-col gap-3">
      <h3 id={`${ids}-heading`} className="bo-text-subheading">
        {SUMMARY_COPY.split}
      </h3>
      <div className="bo-card">
        <dl className="grid grid-cols-2 gap-4">
          {parts.map((part) => (
            <div key={part.tone} className="flex min-w-0 flex-col gap-1" data-split={part.tone}>
              <dt className="bo-stat__label flex items-center gap-1.5">
                <span className={`bo-split-swatch bo-split-swatch--${part.tone}`} aria-hidden />
                {part.label}
              </dt>
              <dd className="m-0 [overflow-wrap:anywhere]">
                <span className="bo-amount bo-text-body text-text" aria-hidden>
                  {formatMoney(part.value.penCents, "PEN")}
                </span>
                {part.value.unconvertedUsdCents > 0 ? (
                  <span className="bo-amount bo-text-body-sm block text-text-secondary" aria-hidden>
                    {SUMMARY_COPY.unconverted(formatMoney(part.value.unconvertedUsdCents, "USD"))}
                  </span>
                ) : null}
                <span className="sr-only">
                  {spokenTotal(part.value.penCents, part.value.unconvertedUsdCents)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        {total > 0 ? (
          <span className="bo-summary-bar bo-summary-bar--split" aria-hidden>
            <span
              className="bo-summary-bar__fill"
              style={{ width: `${((summary.recurring.penCents / total) * 100).toFixed(2)}%` }}
            />
          </span>
        ) : null}
      </div>
    </section>
  );
}
