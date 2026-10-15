"use client";

import { Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
import {
  applyFilters,
  countActive,
  DAYS_PER_PAGE,
  EXPENSES_PER_PAGE,
  matches,
  NO_FILTERS,
  NO_METHOD_KEY,
  paginate,
  sortExpenses,
  summarizeSelection,
  type ExpenseFilters,
  type SortKey,
} from "../expense-filters";
import { expenseRowText, groupByDay } from "../month-list";
import { FIRST_MONTH, monthHref, monthOrder, sectionGroup, shiftMonth } from "../routes";
import {
  compareToPrevious,
  cumulativeByDay,
  monthlyTotals,
  monthPoint,
  type MonthlyTotal,
} from "../trend";
import { groupKey, summarizeMonth, type MonthPending, type SummaryGroup } from "../summary";
import { shortDay } from "../payments-copy";
import { moneyTotalText, spokenTotal, SUMMARY_COPY } from "../summary-copy";
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
import { FilterChips, type ChipItem } from "./filter-chip";
import { ExpenseFiltersPanel, type Option } from "./expense-filters-panel";
import { PresenceItem } from "./presence-item";
import { PendingPayments } from "./pending-payments";
import { StackedBar } from "./stacked-bar";

type SheetState = { key: number; open: boolean; expense: ExpenseItem | null };

/** The list's filters and pages of one month; another month shows none. */
type ListState = { month: string; filters: ExpenseFilters; pages: number };

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
  const [listState, setListState] = useState<ListState | null>(null);
  const [sort, setSort] = useState<SortKey>("recent");
  const [panelOpen, setPanelOpen] = useState(false);
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
  const filtersButton = useRef<HTMLButtonElement>(null);
  const chipRemovers = useRef(new Map<string, HTMLButtonElement>());
  const moreButton = useRef<HTMLButtonElement>(null);
  // The first row a «Mostrar más» brings: it takes focus if the button goes away with it.
  const moreFocus = useRef<string | null>(null);
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
  // The filters and pages belong to the month they were set on: the arrows leave them behind.
  const scoped = listState?.month === month ? listState : null;
  const active = scoped?.filters ?? NO_FILTERS;
  const pages = scoped?.pages ?? 1;
  const activeCount = countActive(active);
  // The lens over the list only: the month's total, the chart and the summary read every row.
  const filtered = useMemo(
    () => sortExpenses(applyFilters(shown, active), sort),
    [shown, active, sort],
  );
  const page = useMemo(() => paginate(filtered, sort, pages), [filtered, sort, pages]);
  const listed = page.items;
  const selection = useMemo(() => summarizeSelection(filtered), [filtered]);

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

  // A filter never hides what the month has: when an expense the filters would hide arrives (a new
  // one, from the sheet or the quick capture) they all go away, saying why. Adjusted while
  // rendering (React's "storing information from previous renders"); only the saying is an effect.
  const [seenExpenses, setSeenExpenses] = useState(expenses);
  const [filterNotice, setFilterNotice] = useState<{ text: string } | null>(null);
  if (seenExpenses !== expenses) {
    setSeenExpenses(expenses);
    const seen = new Set(seenExpenses.map((expense) => expense.id));
    const outside = expenses.some((expense) => !seen.has(expense.id) && !matches(expense, active));
    if (activeCount > 0 && outside) {
      setListState(null);
      setFilterNotice({ text: SUMMARY_COPY.filtersClearedByNew(expenses.length) });
    }
  }
  useEffect(() => {
    if (filterNotice) announce(filterNotice.text);
  }, [filterNotice, announce]);

  // What the filters leave is said once after a pause (not on every key), and so is going back to
  // the whole month.
  const resultMessage =
    activeCount > 0
      ? SUMMARY_COPY.resultSpoken(
          selection.count,
          spokenTotal(selection.penCents, selection.unconvertedUsdCents),
        )
      : null;
  const wasFiltering = useRef(false);
  const monthCount = shown.length;
  useEffect(() => {
    const timer = setTimeout(() => {
      if (resultMessage) {
        wasFiltering.current = true;
        announce(resultMessage);
      } else if (wasFiltering.current) {
        wasFiltering.current = false;
        announce(SUMMARY_COPY.filterOff(monthCount));
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [resultMessage, monthCount, announce]);

  function goBy(delta: number) {
    const target = shiftMonth(pendingMonth.current ?? month, delta);
    if (target < FIRST_MONTH || target > currentMonth) return;
    pendingMonth.current = target;
    setIntent(delta > 0 ? 1 : -1);
    startNavigation(() => {
      router.push(monthHref(target, currentMonth), { scroll: false });
    });
  }

  /** Changes some filters of this month's list; the pages start over. */
  const updateFilters = useCallback(
    (next: Partial<ExpenseFilters>) => {
      setListState((previous) => ({
        month,
        filters: { ...(previous?.month === month ? previous.filters : NO_FILTERS), ...next },
        pages: 1,
      }));
    },
    [month],
  );

  function toggleCategory(group: SummaryGroup) {
    const key = groupKey(group);
    const adding = !active.categories.includes(key);
    updateFilters({
      categories: adding ? [...active.categories, key] : active.categories.filter((c) => c !== key),
    });
    // The list lives in «Gastos»: a category added in «Resumen» takes you there.
    if (adding) views?.showSection("mes:gas");
  }

  function clearAll() {
    setListState(null);
    filtersButton.current?.focus();
  }

  /** Quits one chip; focus goes to the next chip's key, else the «Filtros» key. */
  function removeChip(key: string, next: Partial<ExpenseFilters>) {
    // Only the chips that are still on (one that is leaving may still be in the map).
    const keys = chips.map((chip) => chip.key);
    const neighbor = keys[keys.indexOf(key) + 1] ?? keys[keys.indexOf(key) - 1];
    updateFilters(next);
    const target = neighbor ? chipRemovers.current.get(neighbor) : undefined;
    (target ?? filtersButton.current)?.focus();
  }

  function showMore() {
    const next = paginate(filtered, sort, pages + 1).items[listed.length];
    moreFocus.current = next?.id ?? null;
    setListState((previous) => ({
      month,
      filters: previous?.month === month ? previous.filters : NO_FILTERS,
      pages: (previous?.month === month ? previous.pages : 1) + 1,
    }));
  }

  // «Mostrar más» that brought the last page goes away: focus moves to the first new row.
  useLayoutEffect(() => {
    const id = moreFocus.current;
    if (!id) return;
    moreFocus.current = null;
    if (!moreButton.current) rows.current.get(id)?.focus();
  });

  const categoryNames = useMemo(() => {
    const names = new Map<string, string>([["none", SUMMARY_COPY.uncategorized]]);
    for (const item of [...catalog.categories, ...catalog.archivedCategories]) {
      names.set(item.id, item.name);
    }
    return names;
  }, [catalog]);
  const methodNames = useMemo(() => {
    const names = new Map<string, string>([[NO_METHOD_KEY, SUMMARY_COPY.noMethod]]);
    for (const item of [...catalog.methods, ...catalog.archivedMethods]) {
      names.set(item.id, item.name);
    }
    return names;
  }, [catalog]);
  const chips: ChipItem[] = [
    ...active.categories.map((key) => ({
      key: `cat:${key}`,
      label: categoryNames.get(key) ?? key,
      onRemove: () =>
        removeChip(`cat:${key}`, { categories: active.categories.filter((c) => c !== key) }),
    })),
    ...active.methods.map((key) => ({
      key: `met:${key}`,
      label: methodNames.get(key) ?? key,
      onRemove: () =>
        removeChip(`met:${key}`, { methods: active.methods.filter((m) => m !== key) }),
    })),
    ...(active.text.trim() !== ""
      ? [
          {
            key: "text",
            label: SUMMARY_COPY.chipText(active.text.trim()),
            onRemove: () => removeChip("text", { text: "" }),
          },
        ]
      : []),
    ...(active.minCents !== null || active.maxCents !== null
      ? [
          {
            key: "amount",
            label: SUMMARY_COPY.chipAmount(
              active.minCents === null ? null : formatMoney(active.minCents, "PEN"),
              active.maxCents === null ? null : formatMoney(active.maxCents, "PEN"),
            ),
            onRemove: () => removeChip("amount", { minCents: null, maxCents: null }),
          },
        ]
      : []),
    ...(active.from !== null || active.to !== null
      ? [
          {
            key: "days",
            label: SUMMARY_COPY.chipDays(
              active.from === null ? null : shortDay(active.from),
              active.to === null ? null : shortDay(active.to),
            ),
            onRemove: () => removeChip("days", { from: null, to: null }),
          },
        ]
      : []),
    ...(active.kind !== "all"
      ? [
          {
            key: "kind",
            label: SUMMARY_COPY.kindOptions[active.kind],
            onRemove: () => removeChip("kind", { kind: "all" }),
          },
        ]
      : []),
    ...(active.currency !== "all"
      ? [
          {
            key: "currency",
            label: SUMMARY_COPY.currencyOptions[active.currency],
            onRemove: () => removeChip("currency", { currency: "all" }),
          },
        ]
      : []),
  ];

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

  /** One row of the list; sorted by amount the rows are flat, so each one says its day. */
  function renderRow(expense: ExpenseItem, withDay: boolean) {
    return (
      <PresenceItem key={expense.id}>
        <ExpenseRow
          expense={expense}
          ref={(element) => {
            if (element) rows.current.set(expense.id, element);
            else rows.current.delete(expense.id);
          }}
          onOpen={(element) => openSheet(expense, element)}
          accent={activeCount > 0 ? expense.category?.colorSlot : undefined}
          filtered={activeCount > 0}
          dayLabel={withDay ? dayTitle(expense.spentOn, today) : undefined}
        />
      </PresenceItem>
    );
  }
  // The options of the panel: the catalog plus whatever the month's rows already use.
  const filterCategories = optionsOf(
    catalog.categories,
    shown.map((e) => e.category),
  );
  const filterMethods = optionsOf(
    catalog.methods,
    shown.map((e) => e.paymentMethod),
  );

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
                  activeKeys={active.categories}
                  onToggle={toggleCategory}
                />
                <CategoryBars
                  categories={summary.categories}
                  activeKeys={active.categories}
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
            <h3
              ref={listHeading}
              id={listHeadingId}
              tabIndex={-1}
              className="bo-text-subheading outline-none"
            >
              {SUMMARY_COPY.listHeading}
            </h3>
            {shown.length > 0 ? (
              <>
                <ExpenseFiltersPanel
                  filters={active}
                  onChange={updateFilters}
                  sort={sort}
                  onSort={setSort}
                  categories={filterCategories}
                  methods={filterMethods}
                  open={panelOpen}
                  onToggle={() => setPanelOpen((open) => !open)}
                  activeCount={activeCount}
                  buttonRef={filtersButton}
                  month={month}
                />
                <FilterChips
                  chips={chips}
                  onClearAll={clearAll}
                  registerRemove={(key, element) => {
                    if (element) chipRemovers.current.set(key, element);
                    else chipRemovers.current.delete(key);
                  }}
                />
                {activeCount > 0 ? (
                  <p
                    className="bo-amount bo-text-body-sm text-text-secondary"
                    data-filter-result=""
                  >
                    <span aria-hidden>
                      {SUMMARY_COPY.resultLine(
                        selection.count,
                        moneyTotalText(selection.penCents, selection.unconvertedUsdCents),
                      )}
                    </span>
                  </p>
                ) : null}
              </>
            ) : null}
            {shown.length === 0 ? (
              <p className="bo-card bo-text-body-sm max-w-160 text-text-secondary">
                {FINANCE_COPY.emptyMonthText}
              </p>
            ) : filtered.length === 0 ? (
              <div
                className="bo-card flex max-w-160 flex-col items-start gap-3"
                data-filter-empty=""
              >
                <p className="bo-text-body-sm text-text-secondary">{SUMMARY_COPY.noResults}</p>
                <Key variant="ghost" onClick={clearAll}>
                  {SUMMARY_COPY.clearAll}
                </Key>
              </div>
            ) : page.byDay ? (
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
                          {group.expenses.map((expense) => renderRow(expense, false))}
                        </AnimatePresence>
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul aria-labelledby={listHeadingId} className="bo-list" data-flat-list="">
                <AnimatePresence initial={false}>
                  {listed.map((expense) => renderRow(expense, true))}
                </AnimatePresence>
              </ul>
            )}
            {page.hasMore ? (
              <div className="flex flex-wrap items-center gap-3" data-more="">
                <Key ref={moreButton} variant="ghost" onClick={showMore}>
                  {page.byDay
                    ? SUMMARY_COPY.showMoreDays(DAYS_PER_PAGE)
                    : SUMMARY_COPY.showMoreExpenses(EXPENSES_PER_PAGE)}
                </Key>
                <p className="bo-text-body-sm text-text-secondary">
                  {page.byDay
                    ? SUMMARY_COPY.shownDays(page.shown, page.total)
                    : SUMMARY_COPY.shownExpenses(page.shown, page.total)}
                </p>
              </div>
            ) : null}
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
  /** Set when the list is flat (sorted by amount): the row says which day it is from. */
  dayLabel?: string;
  onOpen: (element: HTMLButtonElement) => void;
  ref: React.Ref<HTMLButtonElement>;
};

/** One expense: what, amount (and "≈ S/" for USD), method; the whole row opens its edit sheet. */
function ExpenseRow({ expense, onOpen, accent, filtered = false, dayLabel, ref }: ExpenseRowProps) {
  const text = expenseRowText(expense);
  const meta = dayLabel ? [dayLabel, ...text.meta] : text.meta;
  const spoken = [text.spoken, ...meta].join(", ");
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
        {meta.length > 0 ? (
          <span className="bo-row__subtitle truncate">{meta.join(" · ")}</span>
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

/** The panel's options: the catalog's visible items plus the ones the month's rows already use. */
function optionsOf(
  catalog: readonly { id: string; name: string }[],
  used: readonly ({ id: string; name: string } | null)[],
): Option[] {
  const known = new Map<string, Option>(catalog.map((item) => [item.id, item]));
  for (const item of used) if (item && !known.has(item.id)) known.set(item.id, item);
  return [...known.values()].map(({ id, name }) => ({ id, name }));
}
