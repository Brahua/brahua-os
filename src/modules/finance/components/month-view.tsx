"use client";

import { Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { Key } from "@/design-system";
import { deleteExpense, restoreExpense } from "../actions";
import type { ExpenseItem } from "../expense-input";
import { Cascade, useDirectionalSwap } from "@/lib/motion";
import { dayTitle, FINANCE_COPY, monthTitle } from "../finance-copy";
import { categoryStyle } from "../category-color";
import { formatMoney } from "../money";
import type { PendingPeriod } from "../payments-view";
import { expenseRowText, groupByDay } from "../month-list";
import { FIRST_MONTH, monthHref, monthOrder, sectionGroup, shiftMonth } from "../routes";
import {
  compareToPrevious,
  cumulativeByDay,
  monthlyTotals,
  monthPoint,
  type MonthlyTotal,
} from "../trend";
import {
  expenseCategoryKey,
  groupKey,
  summarizeMonth,
  type MonthPending,
  type SummaryGroup,
} from "../summary";
import { spokenTotal, SUMMARY_COPY } from "../summary-copy";
import { ExpenseSheet } from "./expense-sheet";
import { useFinanceScreen } from "./finance-screen";
import { useFinanceViews, ViewPanel } from "./finance-views";
import {
  CategoryBars,
  MixCard,
  MonthArrow,
  MonthContext,
  MonthTotal,
  PendingCard,
  SpentCard,
} from "./month-summary";
import { AreaChart } from "./area-chart";
import { Sparkline } from "./sparkline";
import { FilterChip } from "./filter-chip";
import { PresenceItem } from "./presence-item";
import { PendingPayments } from "./pending-payments";
import { StackedBar } from "./stacked-bar";

type SheetState = { key: number; open: boolean; expense: ExpenseItem | null };

/** The list's filter: a category (or "none") of one month; another month shows no filter. */
type CategoryFilter = { month: string; key: string; name: string };

type MonthViewProps = {
  /** YYYY-MM (Lima). */
  month: string;
  /** The month's visible expenses, the most recent first. */
  expenses: ExpenseItem[];
  /**
   * "Pendiente de pagar" of the month (F2's `getPendingForMonth`: recurring payments still due);
   * null or none: nothing to show.
   */
  pending?: MonthPending | null;
  /** The six months ending at `month` (`getMonthlyTotals`): the comparison reads the previous one. */
  trend?: MonthlyTotal[];
  /** The previous month's running total per day over this month's days (null: no month before). */
  previousCumulative?: number[] | null;
  /** The recurring payments to pay now (overdue or due within 7 days); shown in the current month. */
  pendingPeriods?: PendingPeriod[];
};

/**
 * "Mes" of /finance (SPEC-finance "Pantallas", "Resumen"): the month with its arrows and total
 * (`NumberFlow`), "Pendiente de pagar", the summary (by category, by payment method, recurring and
 * one-off) and the expenses by day (the most recent first). A category's bar filters the list. A
 * row opens "Editar gasto"; deleting is optimistic (the summary follows at once) with "Deshacer"
 * in the screen's notices.
 */
export function MonthView({
  month,
  expenses,
  pending = null,
  trend = [],
  previousCumulative = null,
  pendingPeriods = [],
}: MonthViewProps) {
  const views = useFinanceViews();
  const { today, catalog, enqueue, toaster, announce, openSettings } = useFinanceScreen();
  const router = useRouter();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const listHeadingId = `${ids}-list`;
  const [shown, removeShown] = useOptimistic(expenses, (list, id: string) =>
    list.filter((expense) => expense.id !== id),
  );
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [filter, setFilter] = useState<CategoryFilter | null>(null);
  const [navigating, startNavigation] = useTransition();
  // Which way the arrow pressed last points: the content follows it while the next month loads.
  const [intent, setIntent] = useState<1 | -1>(1);
  const swap = useDirectionalSwap<HTMLDivElement>({
    order: monthOrder(month),
    pending: navigating,
    intent,
  });
  const addKey = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  // Where focus goes when the sheet closes: the row (or key) that opened it, or a neighbor.
  const returnFocus = useRef<HTMLElement | null>(null);
  // What to say, and where focus goes, once the sheet has closed after an edit.
  const afterClose = useRef<{ message: string; id: string; neighbor: string | null } | null>(null);

  const currentMonth = today.slice(0, 7);
  const summary = useMemo(() => summarizeMonth(month, shown), [month, shown]);
  // The comparison with the previous month at the same point of the month (trend.ts); the current
  // side reads the optimistic list, so a delete moves it at once.
  const point = monthPoint(month, today);
  const previousTotal = trend.find((entry) => entry.month === shiftMonth(month, -1));
  const delta = useMemo(
    () =>
      previousTotal
        ? compareToPrevious(
            month,
            FIRST_MONTH,
            monthlyTotals(shown, month, 1, point.day)[0].uptoDayPenCents,
            previousTotal.uptoDayPenCents,
          )
        : null,
    [shown, month, point.day, previousTotal],
  );
  // The pace chart: the month's running total (the optimistic list, so a delete moves it) up to
  // today while the month is current, against the previous month over the same days.
  const shownDays = point.isCurrent ? point.day : point.total;
  const current = useMemo(
    () => cumulativeByDay(shown, month, point.total).slice(0, shownDays),
    [shown, month, point.total, shownDays],
  );
  const previousSeries = previousCumulative ? previousCumulative.slice(0, shownDays) : null;
  // A filter belongs to the month it was set on: the arrows leave it behind.
  const active = filter?.month === month ? filter : null;
  const listed = active
    ? shown.filter((expense) => expenseCategoryKey(expense) === active.key)
    : shown;

  // Another month arrived (the arrows, or back/forward): say which and its total, once.
  const shownMonth = useRef(month);
  // The month an arrow is already going to: fast clicks add up instead of repeating one step.
  const pendingMonth = useRef<string | null>(null);
  const monthMessage = SUMMARY_COPY.monthShown(
    monthTitle(month),
    spokenTotal(summary.total.penCents, summary.total.unconvertedUsdCents),
  );
  useEffect(() => {
    if (shownMonth.current === month) return;
    shownMonth.current = month;
    if (pendingMonth.current === month) pendingMonth.current = null;
    announce(monthMessage);
  }, [month, monthMessage, announce]);

  // A filter never hides what the month has: it goes away when its category has nothing left
  // (the last one deleted or moved), and when an expense of another category arrives (a new one,
  // from the sheet or the quick capture), saying why. Adjusted while rendering (React's
  // "storing information from previous renders"), not in an effect; only the saying is one.
  const [seenExpenses, setSeenExpenses] = useState(expenses);
  const [filterNotice, setFilterNotice] = useState<{ text: string } | null>(null);
  if (active && listed.length === 0) {
    setFilter(null);
    setFilterNotice({ text: SUMMARY_COPY.emptyFiltered(active.name) });
  }
  if (seenExpenses !== expenses) {
    setSeenExpenses(expenses);
    const seen = new Set(seenExpenses.map((expense) => expense.id));
    const outside = expenses.some(
      (expense) => !seen.has(expense.id) && expenseCategoryKey(expense) !== active?.key,
    );
    if (active && outside) {
      setFilter(null);
      setFilterNotice({ text: SUMMARY_COPY.filterClearedByNew(active.name, expenses.length) });
    }
  }
  useEffect(() => {
    if (filterNotice) announce(filterNotice.text);
  }, [filterNotice, announce]);

  function goBy(delta: number) {
    const target = shiftMonth(pendingMonth.current ?? month, delta);
    if (target < FIRST_MONTH || target > currentMonth) return;
    pendingMonth.current = target;
    setIntent(delta > 0 ? 1 : -1);
    startNavigation(() => {
      router.push(monthHref(target, currentMonth), { scroll: false });
    });
  }

  function toggleCategory(group: SummaryGroup) {
    const key = groupKey(group);
    if (active?.key === key) {
      setFilter(null);
      announce(SUMMARY_COPY.filterOff(shown.length));
      return;
    }
    const name = group.name ?? SUMMARY_COPY.uncategorized;
    setFilter({ month, key, name });
    const count = shown.filter((expense) => expenseCategoryKey(expense) === key).length;
    announce(SUMMARY_COPY.filterOn(name, count));
    // The filter lives in «Gastos»: a category tapped in «Resumen» takes you there.
    views?.showSection("mes:gas");
  }

  function clearFilter() {
    // "Quitar filtro" goes away: focus goes to the list's heading (the list stays in view).
    setFilter(null);
    announce(SUMMARY_COPY.filterOff(shown.length));
    listHeading.current?.focus();
  }

  function openSheet(expense: ExpenseItem | null, opener: HTMLElement | null) {
    returnFocus.current = opener;
    setSheet((previous) => ({ key: (previous?.key ?? 0) + 1, open: true, expense }));
  }

  function closeSheet() {
    setSheet((previous) => (previous ? { ...previous, open: false } : previous));
  }

  /** The id of the listed row after `id` (or before it), if any. */
  function neighborIdOf(id: string): string | null {
    const index = listed.findIndex((expense) => expense.id === id);
    return (listed[index + 1] ?? listed[index - 1])?.id ?? null;
  }

  /** The listed row after `id` (or before it), else the add key: where focus goes when it leaves. */
  function neighborOf(id: string): HTMLElement | null {
    const neighbor = neighborIdOf(id);
    return (neighbor ? rows.current.get(neighbor) : undefined) ?? addKey.current ?? heading.current;
  }

  function restore(expense: ExpenseItem) {
    startTransition(async () => {
      const result = await enqueue(`expense-delete:${expense.id}`, () =>
        restoreExpense({ id: expense.id }),
      );
      if (result.kind === "done" && result.value.ok) {
        announce(FINANCE_COPY.restored);
        return;
      }
      if (result.kind === "skipped") return;
      toaster.push({
        title: FINANCE_COPY.notSavedTitle,
        text: `${FINANCE_COPY.notUndone} ${result.kind === "done" && !result.value.ok ? result.value.error : FINANCE_COPY.checkConnection}`,
        tone: "error",
      });
    });
  }

  function deleteRow(expense: ExpenseItem) {
    returnFocus.current = neighborOf(expense.id);
    closeSheet();
    const text = expenseRowText(expense);
    startTransition(async () => {
      removeShown(expense.id);
      const result = await enqueue(`expense-delete:${expense.id}`, () =>
        deleteExpense({ id: expense.id }),
      );
      if (result.kind === "skipped") return;
      if (result.kind === "done" && result.value.ok) {
        toaster.push({
          title: FINANCE_COPY.deletedTitle,
          text: FINANCE_COPY.savedText(text.spoken, text.label),
          action: { label: FINANCE_COPY.undo, run: () => restore(expense) },
        });
        return;
      }
      // Back in the list (the optimistic removal ends with the transition).
      toaster.push({
        title: FINANCE_COPY.notSavedTitle,
        text: `${FINANCE_COPY.notDeleted} ${result.kind === "done" && !result.value.ok ? result.value.error : FINANCE_COPY.checkConnection}`,
        tone: "error",
      });
    });
  }

  const groups = groupByDay(listed);
  const previous = month > FIRST_MONTH ? shiftMonth(month, -1) : null;
  const next = month < currentMonth ? shiftMonth(month, 1) : null;

  const monthHidden = views ? sectionGroup(views.section) !== "month" : false;
  const dayTotals = new Map(
    groups.map((group) => [group.day, summarizeMonth(month, group.expenses).total]),
  );

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={navigating || undefined}
      className="flex flex-col gap-6"
      data-finance-month={month}
      hidden={monthHidden}
    >
      <Cascade index={2} className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-1">
            <MonthArrow
              direction="previous"
              targetTitle={previous ? monthTitle(previous) : null}
              onGo={() => goBy(-1)}
            />
            <h2
              ref={heading}
              id={headingId}
              tabIndex={-1}
              className="bo-text-title min-w-0 px-1 outline-none"
            >
              {monthTitle(month)}
            </h2>
            <MonthArrow
              direction="next"
              targetTitle={next ? monthTitle(next) : null}
              onGo={() => goBy(1)}
            />
          </div>
          <MonthTotal
            total={summary.total}
            rateSet={catalog.usdToPenE4 !== null}
            onSetRate={(opener) => openSettings(opener)}
          />
          <MonthContext
            delta={delta}
            samePoint={point.isCurrent}
            point={point.isCurrent ? point : null}
            excludesUsd={
              summary.total.unconvertedUsdCents > 0 || (previousTotal?.unconvertedUsdCents ?? 0) > 0
            }
          />
        </div>
        <Key
          ref={addKey}
          variant="signal"
          icon={Plus}
          onClick={(event) => openSheet(null, event.currentTarget)}
          aria-haspopup="dialog"
        >
          {FINANCE_COPY.addExpense}
        </Key>
      </Cascade>

      {/* What follows the month's arrows: it leaves towards the arrow while the next month loads
          and arrives from the other side (`useDirectionalSwap`); focus stays on the arrow above. */}
      <div ref={swap} className="flex flex-col gap-6">
        <ViewPanel section="mes:res">
          <Cascade index={3} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SpentCard
              total={summary.total}
              sparkline={<Sparkline totals={trend.map((entry) => entry.penCents)} />}
            />
            {pending && pending.count > 0 ? <PendingCard pending={pending} /> : null}
          </Cascade>

          {shown.length > 0 ? (
            <>
              <Cascade index={4} className="flex flex-col gap-3">
                <h3 className="bo-text-subheading">{SUMMARY_COPY.chartHeading}</h3>
                {summary.total.penCents > 0 ? (
                  <AreaChart
                    key={month}
                    current={current}
                    previous={previousSeries}
                    days={point.total}
                    today={point.isCurrent ? point.day : null}
                  />
                ) : (
                  <p
                    className="bo-card bo-text-body-sm max-w-160 text-text-secondary"
                    data-chart-empty=""
                  >
                    {SUMMARY_COPY.chartEmpty}
                  </p>
                )}
              </Cascade>
              <Cascade
                index={5}
                className="flex flex-col gap-4"
                attrs={{ "data-month-summary": "" }}
              >
                <StackedBar
                  categories={summary.categories}
                  activeKey={active?.key ?? null}
                  onToggle={toggleCategory}
                />
                <CategoryBars
                  categories={summary.categories}
                  activeKey={active?.key ?? null}
                  onToggle={toggleCategory}
                />
              </Cascade>
              <Cascade index={6}>
                <MixCard summary={summary} />
              </Cascade>
            </>
          ) : (
            <Cascade index={4}>
              <div className="bo-card max-w-160" data-finance-empty="">
                <p className="bo-text-body font-semibold">{FINANCE_COPY.emptyMonthTitle}</p>
                <p className="bo-text-body-sm text-text-secondary">{FINANCE_COPY.emptyMonthText}</p>
              </div>
            </Cascade>
          )}
        </ViewPanel>

        <ViewPanel section="mes:gas">
          {/* What is left to pay (overdue or due within 7 days) belongs to now: only this month. */}
          {month === currentMonth ? <PendingPayments pending={pendingPeriods} /> : null}
          <section aria-labelledby={listHeadingId} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h3
                ref={listHeading}
                id={listHeadingId}
                tabIndex={-1}
                className="bo-text-subheading outline-none"
              >
                {SUMMARY_COPY.listHeading}
              </h3>
              <FilterChip name={active?.name ?? null} count={listed.length} onClear={clearFilter} />
            </div>
            {shown.length === 0 ? (
              <p className="bo-card bo-text-body-sm max-w-160 text-text-secondary">
                {FINANCE_COPY.emptyMonthText}
              </p>
            ) : groups.length === 0 ? (
              <p className="bo-card bo-text-body-sm max-w-160 text-text-secondary">
                {active ? SUMMARY_COPY.emptyFiltered(active.name) : null}
              </p>
            ) : (
              <div className="flex flex-col gap-6">
                {groups.map((group) => {
                  const dayId = `${ids}-${group.day}`;
                  const dayTotal = dayTotals.get(group.day);
                  return (
                    <div key={group.day} className="flex flex-col gap-2">
                      <div className="flex items-baseline gap-3">
                        <h4 id={dayId} className="bo-section-label min-w-0 flex-1">
                          <span className="bo-section-label__title">
                            {dayTitle(group.day, today)}
                          </span>
                        </h4>
                        {dayTotal ? (
                          <span className="bo-amount bo-text-body-sm" data-day-total={group.day}>
                            <span aria-hidden>{formatMoney(dayTotal.penCents, "PEN")}</span>
                            <span className="sr-only">
                              {SUMMARY_COPY.dayTotalSpoken(
                                spokenTotal(dayTotal.penCents, dayTotal.unconvertedUsdCents),
                              )}
                            </span>
                          </span>
                        ) : null}
                      </div>
                      <ul aria-labelledby={dayId} className="bo-list">
                        <AnimatePresence initial={false}>
                          {group.expenses.map((expense) => (
                            <PresenceItem key={expense.id}>
                              <ExpenseRow
                                expense={expense}
                                ref={(element) => {
                                  if (element) rows.current.set(expense.id, element);
                                  else rows.current.delete(expense.id);
                                }}
                                onOpen={(element) => openSheet(expense, element)}
                                accent={active ? expense.category?.colorSlot : undefined}
                                filtered={active !== null}
                              />
                            </PresenceItem>
                          ))}
                        </AnimatePresence>
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </ViewPanel>
      </div>

      {sheet ? (
        <ExpenseSheet
          key={sheet.key}
          open={sheet.open}
          onOpenChange={(open) => (open ? undefined : closeSheet())}
          returnFocusRef={returnFocus}
          expense={sheet.expense}
          catalog={catalog}
          today={today}
          onSaved={(saved) => {
            // An edit shows in its row: it is said once the sheet is gone (the page is hidden
            // from screen readers until then), not a notice (a plain notice would hold back the
            // next one's "Deshacer").
            if (!sheet.expense) return;
            const text = expenseRowText(saved);
            afterClose.current = {
              message: `${FINANCE_COPY.editedTitle}: ${FINANCE_COPY.savedText(text.spoken, text.label)}.`,
              id: saved.id,
              neighbor: neighborIdOf(saved.id),
            };
          }}
          onClosed={() => {
            const after = afterClose.current;
            afterClose.current = null;
            if (!after) return;
            // A new date can move the row to another day (a new element) or out of the month,
            // and a new category out of a filtered list: focus goes to the row as it is now,
            // else a neighbor, else the month's heading.
            const target =
              rows.current.get(after.id) ??
              (after.neighbor ? rows.current.get(after.neighbor) : undefined) ??
              heading.current;
            target?.focus();
            announce(after.message);
          }}
          onDelete={deleteRow}
        />
      ) : null}
    </section>
  );
}

type ExpenseRowProps = {
  expense: ExpenseItem;
  /** The category's accent slot, drawn as a 2 px line only while the list is filtered. */
  accent?: number | null;
  filtered?: boolean;
  onOpen: (element: HTMLButtonElement) => void;
  ref: React.Ref<HTMLButtonElement>;
};

/** One expense: what, amount (and "≈ S/" for USD), method; the whole row opens its edit sheet. */
function ExpenseRow({ expense, onOpen, accent, filtered = false, ref }: ExpenseRowProps) {
  const text = expenseRowText(expense);
  const spoken = [text.spoken, ...text.meta].join(", ");
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="dialog"
      aria-label={`${FINANCE_COPY.editExpense(text.label, spoken)}`}
      onClick={(event) => onOpen(event.currentTarget)}
      className="bo-row"
      data-expense-row={expense.id}
      data-accent={filtered ? "" : undefined}
      style={filtered ? categoryStyle(accent) : undefined}
    >
      <span className="bo-row__body" aria-hidden>
        <span className="bo-row__title truncate">{text.label}</span>
        {text.meta.length > 0 ? (
          <span className="bo-row__subtitle truncate">{text.meta.join(" · ")}</span>
        ) : null}
      </span>
      <span className="bo-row__trail flex-col items-end gap-0.5" aria-hidden>
        <span className="bo-amount bo-text-body text-text">{text.amount}</span>
        {text.converted ? (
          <span className="bo-amount bo-text-body-sm">{text.converted}</span>
        ) : null}
      </span>
    </button>
  );
}
