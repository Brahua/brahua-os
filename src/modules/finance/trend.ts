// How the month compares with the previous ones (finance-motion M2). Pure and client-safe: it
// works over the thin rows `getMonthlyTotals` reads, converting each expense with the same
// `toPenCents` as summary.ts, so a total here always equals the one the summary shows.
//
// "Same point of the month": the comparison is the spent so far (up to day n) against what the
// previous month had spent by its own day n, never the whole previous month. A month that is over
// compares whole against whole (its n is its last day). USD without a stored rate is excluded from
// every figure here (it is summed apart, "sin convertir") and flagged so the screen says so.
import type { Currency } from "./finance-constants";
import { toPenCents } from "./money";
import { monthOrder, shiftMonth } from "./routes";

/** What the trend reads of an expense (a thin row of the six-month read). */
export type TrendExpense = {
  amountCents: number;
  currency: Currency;
  exchangeRateE4: number | null;
  /** A Lima day, YYYY-MM-DD. */
  spentOn: string;
};

/** One month's figures, in PEN cents. */
export type MonthlyTotal = {
  month: string;
  /** The whole month. */
  penCents: number;
  /** The month up to the day asked for (inclusive). */
  uptoDayPenCents: number;
  /** USD cents with no rate, left out of both figures above. */
  unconvertedUsdCents: number;
};

/** Days in `month` (YYYY-MM). */
export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/** The point of the month the comparison stops at: today's day number in the current month. */
export function monthPoint(
  month: string,
  today: string,
): { day: number; total: number; isCurrent: boolean } {
  const total = daysInMonth(month);
  if (today.slice(0, 7) !== month) return { day: total, total, isCurrent: false };
  return { day: Number(today.slice(8, 10)), total, isCurrent: true };
}

/**
 * The `count` months ending at `month` (oldest first), each with its whole total and its total up
 * to `day` of that month (a shorter month is bounded by its own length: day 31 of February is its
 * last day). Months with no expenses are present with zeros.
 */
export function monthlyTotals(
  expenses: readonly TrendExpense[],
  month: string,
  count: number,
  day: number,
): MonthlyTotal[] {
  const months = Array.from({ length: count }, (_, index) => shiftMonth(month, index - count + 1));
  const byMonth = new Map<string, MonthlyTotal>(
    months.map((key) => [
      key,
      { month: key, penCents: 0, uptoDayPenCents: 0, unconvertedUsdCents: 0 },
    ]),
  );
  for (const expense of expenses) {
    const total = byMonth.get(expense.spentOn.slice(0, 7));
    if (!total) continue;
    const pen = toPenCents(expense.amountCents, expense.currency, expense.exchangeRateE4);
    if (pen === null) {
      total.unconvertedUsdCents += expense.amountCents;
      continue;
    }
    total.penCents += pen;
    if (Number(expense.spentOn.slice(8, 10)) <= day) total.uptoDayPenCents += pen;
  }
  return months.map((key) => byMonth.get(key)!);
}

/** A neutral comparison: how far above or below the previous month, in whole percent. */
export type Delta = { percent: number; direction: "up" | "down" | "same" };

/**
 * The comparison of `current` against `previous` (both "up to the same point"), or null when
 * there is nothing to compare against: no month before 2000-01, or a previous month with nothing
 * spent by then (a percentage over zero says nothing).
 */
export function compareToPrevious(
  month: string,
  firstMonth: string,
  current: number,
  previous: number,
): Delta | null {
  if (monthOrder(month) <= monthOrder(firstMonth) || previous <= 0) return null;
  const percent = Math.round(((current - previous) * 100) / previous);
  return {
    percent: Math.abs(percent),
    direction: percent > 0 ? "up" : percent < 0 ? "down" : "same",
  };
}

/**
 * The month's running total in PEN cents, one entry per day (index 0 is day 1) for `days` days:
 * what the chart draws. Unconverted USD is left out (like every figure here). Days past `days`
 * are ignored (a longer previous month is bounded by the shorter current one).
 */
export function cumulativeByDay(
  expenses: readonly TrendExpense[],
  month: string,
  days = daysInMonth(month),
): number[] {
  const perDay = Array.from({ length: days }, () => 0);
  for (const expense of expenses) {
    if (expense.spentOn.slice(0, 7) !== month) continue;
    const day = Number(expense.spentOn.slice(8, 10));
    if (day < 1 || day > days) continue;
    const pen = toPenCents(expense.amountCents, expense.currency, expense.exchangeRateE4);
    if (pen !== null) perDay[day - 1] += pen;
  }
  let sum = 0;
  return perDay.map((value) => (sum += value));
}
