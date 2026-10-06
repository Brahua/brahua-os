// What the "Pagos" view and the month's "Pendiente de pagar" show (F2, SPEC-finance "Pantallas"
// → Pagos, "Pendientes"). Pure and client-safe: the reads pass the visible payments, their
// settlements around today and Lima's today.
import { toPenCents } from "./money";
import type { RecurringItem, SettlementExpense, SettlementItem } from "./recurring-input";
import {
  dueDatesBetween,
  monthOfDay,
  monthRange,
  nextOpenDue,
  OVERDUE_WINDOW_DAYS,
  addDays,
  pendingPeriods,
  pendingWindow,
} from "./schedule";

/** A pending period: overdue (≤ 60 days) or due within 7 days, with no settlement. */
export type PendingPeriod = { recurring: RecurringItem; dueOn: string };

/** A row of "Este mes": a period due this month and its status, or "No toca este mes". */
export type MonthEntry =
  | {
      recurring: RecurringItem;
      dueOn: string;
      status: "paid";
      expense: SettlementExpense;
    }
  | { recurring: RecurringItem; dueOn: string; status: "pending" | "skipped"; expense: null }
  | { recurring: RecurringItem; dueOn: null; status: "none"; expense: null; nextDue: string };

/** A row of "Todos": an active payment and its next due date (from today). */
export type ActiveEntry = { recurring: RecurringItem; nextDue: string };

export type PaymentsViewData = {
  /** Lima's today (YYYY-MM-DD) the view was computed for. */
  today: string;
  /** Pendientes, oldest first. */
  pending: PendingPeriod[];
  /** Este mes (today's month), by due date; the ones with none this month at the end. */
  thisMonth: MonthEntry[];
  /** Todos: the active ones by next due date. */
  active: ActiveEntry[];
  /** Archivados, by name. */
  archived: RecurringItem[];
};

const byName = (a: RecurringItem, b: RecurringItem) => a.name.localeCompare(b.name, "es");

/** Settlements by payment, then by due date. */
function index(settlements: readonly SettlementItem[]) {
  const map = new Map<string, Map<string, SettlementItem>>();
  for (const settlement of settlements) {
    let dues = map.get(settlement.recurringId);
    if (!dues) map.set(settlement.recurringId, (dues = new Map()));
    dues.set(settlement.dueOn, settlement);
  }
  return (recurringId: string) => map.get(recurringId) ?? new Map<string, SettlementItem>();
}

/**
 * The days whose settlements the view needs: the pending window and today's month (the reads
 * fetch exactly this range).
 */
export function settlementRange(today: string): { from: string; to: string } {
  const window = pendingWindow(today);
  const month = monthRange(monthOfDay(today));
  return {
    from: window.from < month.from ? window.from : month.from,
    to: window.to > month.to ? window.to : month.to,
  };
}

/** The "Pagos" view: pending, this month, all active by next due date, archived. */
export function buildPaymentsView(
  items: readonly RecurringItem[],
  settlements: readonly SettlementItem[],
  today: string,
): PaymentsViewData {
  const settledOf = index(settlements);
  const active = items.filter((item) => !item.archived);
  const month = monthRange(monthOfDay(today));

  const pending: PendingPeriod[] = active
    .flatMap((recurring) =>
      pendingPeriods(recurring, new Set(settledOf(recurring.id).keys()), today).map((dueOn) => ({
        recurring,
        dueOn,
      })),
    )
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || byName(a.recurring, b.recurring));

  const due: MonthEntry[] = [];
  const none: MonthEntry[] = [];
  for (const recurring of active) {
    const dates = dueDatesBetween(recurring, month.from, month.to);
    if (dates.length === 0) {
      none.push({
        recurring,
        dueOn: null,
        status: "none",
        expense: null,
        nextDue: nextOpenDue(recurring, today, new Set(settledOf(recurring.id).keys())),
      });
      continue;
    }
    const settled = settledOf(recurring.id);
    for (const dueOn of dates) {
      const settlement = settled.get(dueOn);
      if (settlement?.status === "paid" && settlement.expense) {
        due.push({ recurring, dueOn, status: "paid", expense: settlement.expense });
      } else {
        due.push({
          recurring,
          dueOn,
          status: settlement?.status === "skipped" ? "skipped" : "pending",
          expense: null,
        });
      }
    }
  }
  due.sort(
    (a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? "") || byName(a.recurring, b.recurring),
  );
  none.sort((a, b) => byName(a.recurring, b.recurring));

  const activeEntries = active
    .map((recurring) => ({
      recurring,
      nextDue: nextOpenDue(recurring, today, new Set(settledOf(recurring.id).keys())),
    }))
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue) || byName(a.recurring, b.recurring));

  return {
    today,
    pending,
    thisMonth: [...due, ...none],
    active: activeEntries,
    archived: items.filter((item) => item.archived).sort(byName),
  };
}

/**
 * What is left to pay of the recurring payments in a month (F3's "Pendiente de pagar"): the
 * pending periods of the active payments due in `month`, never older than the 60-day window.
 * Amounts in PEN (USD with the current rate of Ajustes, since nothing was paid yet); USD without
 * a rate apart; variable ones (no amount) only counted.
 */
export type PendingForMonth = {
  /** Pending periods due in the month (variable ones included). */
  count: number;
  /** Their known amounts in PEN cents (USD converted with the current rate). */
  totalPenCents: number;
  /** USD cents that couldn't be converted (no rate set). */
  unconvertedUsdCents: number;
  /** How many of them have no amount ("Monto variable"): not in the total. */
  variableCount: number;
};

/** The days of `month` a pending period can be due on (from the 60-day window on). */
export function pendingMonthRange(month: string, today: string): { from: string; to: string } {
  const range = monthRange(month);
  const oldest = addDays(today, -OVERDUE_WINDOW_DAYS);
  return { from: range.from > oldest ? range.from : oldest, to: range.to };
}

export function pendingForMonth(
  items: readonly RecurringItem[],
  settlements: readonly SettlementItem[],
  month: string,
  today: string,
  usdToPenE4: number | null,
): PendingForMonth {
  const settledOf = index(settlements);
  const { from, to } = pendingMonthRange(month, today);
  const result: PendingForMonth = {
    count: 0,
    totalPenCents: 0,
    unconvertedUsdCents: 0,
    variableCount: 0,
  };
  if (from > to) return result;
  for (const recurring of items) {
    if (recurring.archived) continue;
    const settled = settledOf(recurring.id);
    for (const dueOn of dueDatesBetween(recurring, from, to)) {
      if (settled.has(dueOn)) continue;
      result.count += 1;
      if (recurring.amountCents === null) {
        result.variableCount += 1;
        continue;
      }
      const pen = toPenCents(recurring.amountCents, recurring.currency, usdToPenE4);
      if (pen === null) result.unconvertedUsdCents += recurring.amountCents;
      else result.totalPenCents += pen;
    }
  }
  return result;
}
