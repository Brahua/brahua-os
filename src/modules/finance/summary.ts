// The month's summary of `finance` (SPEC-finance "Resumen"). Pure and client-safe: it runs over the
// month's rows the page already loaded (no extra query) and again over the optimistic list, so a
// delete changes the totals at once.
//
// Money rules (money.ts): each expense becomes PEN cents on its own, PEN as it is and USD with the
// rate stored on it, rounded half up to the cent; every total is a sum of those whole cents, so the
// categories (and the methods, and recurring + one-off) always add up to the month's total. USD
// without a stored rate is never guessed: it is summed apart, "sin convertir".
//
// Percentages (categories): whole numbers by the largest remainder method, over the converted PEN
// total. Each one starts at its floor (100 × amount / total, rounded down); the points still
// missing to 100 go one each to the largest remainders, ties to the earlier category of the list.
// So they always add up to exactly 100 (with any PEN in the month). A category with PEN that rounds
// to 0 shows "< 1%"; one with only unconverted USD has no percentage (null), and with no PEN at
// all in the month none has one.
import type { ExpenseItem, ExpenseRef } from "./expense-input";
import { toPenCents } from "./money";
import type { PendingForMonth } from "./payments-view";

/** What the summary reads of an expense (an ExpenseItem fits; `deletedAt`, if any, leaves it out). */
export type SummaryExpense = Pick<
  ExpenseItem,
  | "amountCents"
  | "currency"
  | "exchangeRateE4"
  | "spentOn"
  | "category"
  | "paymentMethod"
  | "recurringPaymentId"
> & { deletedAt?: Date | string | null };

/** An amount in PEN plus the USD that could not be converted (no stored rate). */
export type MoneyTotal = { penCents: number; unconvertedUsdCents: number; count: number };

/** A category or a payment method with what was spent with it. */
export type SummaryGroup = MoneyTotal & {
  /** The category's or method's id; null for "Sin categoría" / "Sin medio de pago". */
  id: string | null;
  /** Its name; null for none (the screen names it). */
  name: string | null;
  /** Its exact share of the converted PEN total (0–1): the bar's width. */
  share: number;
  /** Whole percentage (largest remainder, they add up to 100); null without PEN. */
  percent: number | null;
};

export type MonthSummary = {
  total: MoneyTotal;
  /** By PEN amount (then unconverted USD, then name), "Sin categoría" last. */
  categories: SummaryGroup[];
  /** Same order, "Sin medio de pago" last. Percentages too, though the screen shows amounts. */
  methods: SummaryGroup[];
  /** Expenses that paid a recurring payment (`recurringPaymentId`). */
  recurring: MoneyTotal;
  /** The rest: loose expenses. */
  oneOff: MoneyTotal;
};

/**
 * "Pendiente de pagar" of a month: the recurring payments still due in it (F2's
 * `getPendingForMonth`): how many, their known total in PEN, the USD without a rate apart and how
 * many have a variable amount (counted, never summed).
 */
export type MonthPending = PendingForMonth;

/** The key a category (or none) is filtered by: its id, or "none" for "Sin categoría". */
export const NO_GROUP_KEY = "none";
export const groupKey = (group: Pick<SummaryGroup, "id">) => group.id ?? NO_GROUP_KEY;
export const expenseCategoryKey = (expense: Pick<ExpenseItem, "category">) =>
  expense.category?.id ?? NO_GROUP_KEY;

const emptyTotal = (): MoneyTotal => ({ penCents: 0, unconvertedUsdCents: 0, count: 0 });

function add(total: MoneyTotal, expense: SummaryExpense): void {
  const pen = toPenCents(expense.amountCents, expense.currency, expense.exchangeRateE4);
  if (pen === null) total.unconvertedUsdCents += expense.amountCents;
  else total.penCents += pen;
  total.count += 1;
}

type Bucket = MoneyTotal & { id: string | null; name: string | null };

const NAME_ORDER = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Biggest first; "none" last; ties by unconverted USD, then by name. */
function byAmount(a: Bucket, b: Bucket): number {
  if ((a.id === null) !== (b.id === null)) return a.id === null ? 1 : -1;
  return (
    b.penCents - a.penCents ||
    b.unconvertedUsdCents - a.unconvertedUsdCents ||
    NAME_ORDER.compare(a.name ?? "", b.name ?? "")
  );
}

/**
 * Whole percentages of `amounts` over `total` that add up to exactly 100: floors first, then one
 * point each to the largest remainders (ties: the earlier one). Integer arithmetic only.
 */
export function largestRemainderPercents(amounts: readonly number[], total: number): number[] {
  if (total <= 0) return amounts.map(() => 0);
  const floors = amounts.map((amount) => Math.floor((amount * 100) / total));
  // Remainders compared as integers: (amount × 100) mod total.
  const remainders = amounts.map((amount) => (amount * 100) % total);
  let missing = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = amounts
    .map((_, index) => index)
    .sort((a, b) => remainders[b] - remainders[a] || a - b);
  for (const index of order) {
    if (missing <= 0) break;
    if (amounts[index] <= 0) continue;
    floors[index] += 1;
    missing -= 1;
  }
  return floors;
}

function groupsOf(
  expenses: readonly SummaryExpense[],
  refOf: (expense: SummaryExpense) => ExpenseRef | null,
  totalPen: number,
): SummaryGroup[] {
  const buckets = new Map<string, Bucket>();
  for (const expense of expenses) {
    const ref = refOf(expense);
    const key = ref?.id ?? NO_GROUP_KEY;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { ...emptyTotal(), id: ref?.id ?? null, name: ref?.name ?? null };
      buckets.set(key, bucket);
    }
    add(bucket, expense);
  }
  const sorted = [...buckets.values()].sort(byAmount);
  const percents = largestRemainderPercents(
    sorted.map((bucket) => bucket.penCents),
    totalPen,
  );
  return sorted.map((bucket, index) => ({
    ...bucket,
    share: totalPen > 0 ? bucket.penCents / totalPen : 0,
    percent: totalPen > 0 && bucket.penCents > 0 ? percents[index] : null,
  }));
}

/** Whether a Lima day (YYYY-MM-DD) is in `month` (YYYY-MM). */
const inMonth = (day: string, month: string) => day.slice(0, 7) === month;

/**
 * The summary of `month` (YYYY-MM, Lima days) from its expenses: the total in PEN (plus USD "sin
 * convertir"), by category, by payment method, and recurring vs one-off. Deleted expenses and
 * days of another month are left out (the page only passes the month's visible ones anyway).
 */
export function summarizeMonth(month: string, expenses: readonly SummaryExpense[]): MonthSummary {
  const counted = expenses.filter(
    (expense) => !expense.deletedAt && inMonth(expense.spentOn, month),
  );
  const total = emptyTotal();
  const recurring = emptyTotal();
  const oneOff = emptyTotal();
  for (const expense of counted) {
    add(total, expense);
    add(expense.recurringPaymentId ? recurring : oneOff, expense);
  }
  return {
    total,
    categories: groupsOf(counted, (expense) => expense.category, total.penCents),
    methods: groupsOf(counted, (expense) => expense.paymentMethod, total.penCents),
    recurring,
    oneOff,
  };
}
