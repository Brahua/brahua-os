// Due dates of recurring payments (SPEC-finance "Ciclos", "Vencimientos", "Pendientes"). Pure and
// client-safe: every day is a YYYY-MM-DD key of Lima's calendar, read as a UTC midnight so nothing
// depends on the host's time zone; "today" is always passed in (`ownerDateKey(now)`).
//
// The four cycles:
// - weekly: every ISO weekday `weekday` (1 = Monday … 7 = Sunday);
// - monthly: day `dayOfMonth` (1–31) of every month, clamped to the month's end (31 → Feb 28/29,
//   Apr 30), like tasks' "el día X del mes" (T3);
// - every_n_months: day `dayOfMonth` (clamped) every `intervalMonths` (2–12) months. The first due
//   date is the first one in `anchorMonth` on or after the start date ("desde marzo": the next
//   March), then every N months from it; nothing is counted back before it;
// - yearly: day `dayOfMonth` of `anchorMonth` (Feb 29 → Feb 28 in a non-leap year).
// Only due dates on or after `startDate` count (the first period is the first due date ≥ it).
//
// Installments ("cuotas", polish → installments): a monthly payment with `installmentsTotal = N`
// has exactly N due dates, one per month from the first one on or after `startDate`; the Nth is
// the last and nothing is generated after it. The installment number of a due date is its position
// (1-based) among those N, so a skipped period still counts (skipping never shifts the count).
import type { PaymentCycle } from "./finance-constants";

/** What the schedule of a recurring payment needs (the columns of its row). */
export type Schedule = {
  cycle: PaymentCycle;
  weekday: number | null;
  dayOfMonth: number | null;
  intervalMonths: number | null;
  anchorMonth: number | null;
  /** First due date counted (YYYY-MM-DD). */
  startDate: string;
  /** Monthly only: the payment ends after this many due dates (the Nth is the last); null: never. */
  installmentsTotal?: number | null;
};

/** Pending periods older than this many days stop showing (SPEC-finance "Pendientes": sin culpa). */
export const OVERDUE_WINDOW_DAYS = 60;
/** Periods due within this many days show as pending ahead of time ("Pagar antes de tiempo"). */
export const UPCOMING_DAYS = 7;

const MS_PER_DAY = 86_400_000;

function parseKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

function toKey(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** `day` plus `days` (negative goes back), as a YYYY-MM-DD key. */
export function addDays(day: string, days: number): string {
  return toKey(new Date(parseKey(day).getTime() + days * MS_PER_DAY));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseKey(to).getTime() - parseKey(from).getTime()) / MS_PER_DAY);
}

/** Days in a month (`month0` 0–11), leap years included. */
function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** ISO weekday of a key: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const weekday = parseKey(day).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The first and last day of a month (YYYY-MM). */
export function monthRange(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const month0 = Number(month.slice(5, 7)) - 1;
  return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(year, month0))}` };
}

/** Months as one running number (year × 12 + month0), to step and compare them. */
const monthIndex = (year: number, month0: number) => year * 12 + month0;

/**
 * The due date of a month-based cycle in the month `index` (year × 12 + month0), or null when
 * the cycle has none that month. Ignores the start date (the callers filter by it).
 */
function dueInMonthIndex(schedule: Schedule, index: number): string | null {
  const year = Math.floor(index / 12);
  const month0 = index - year * 12;
  const day = schedule.dayOfMonth;
  if (day === null) throw new Error("A month-based cycle needs dayOfMonth");
  switch (schedule.cycle) {
    case "monthly":
      break;
    case "every_n_months": {
      const interval = schedule.intervalMonths;
      const anchor = schedule.anchorMonth;
      if (interval === null || anchor === null) {
        throw new Error("every_n_months needs intervalMonths and anchorMonth");
      }
      const anchorIndex = firstAnchorIndex(schedule.startDate, anchor, day);
      if (index < anchorIndex || (index - anchorIndex) % interval !== 0) return null;
      break;
    }
    case "yearly":
      if (schedule.anchorMonth === null) throw new Error("yearly needs anchorMonth");
      if (month0 !== schedule.anchorMonth - 1) return null;
      break;
    case "weekly":
      throw new Error("weekly is not month-based");
  }
  return clampedDay(year, month0, day);
}

/** The day `day` (clamped to the month's end) of a month, as a key. */
function clampedDay(year: number, month0: number, day: number): string {
  return `${year}-${pad(month0 + 1)}-${pad(Math.min(day, daysInMonth(year, month0)))}`;
}

/** The month (index) of the first due date in `anchor` (1–12) on or after `startDate`. */
function firstAnchorIndex(startDate: string, anchor: number, day: number): number {
  const startYear = Number(startDate.slice(0, 4));
  const year = clampedDay(startYear, anchor - 1, day) >= startDate ? startYear : startYear + 1;
  return monthIndex(year, anchor - 1);
}

function indexOfKey(day: string): number {
  return monthIndex(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1);
}

/** The later of two keys. */
const later = (a: string, b: string) => (a > b ? a : b);

/** The month (index) of a monthly payment's first due date: the first one on or after the start. */
function firstMonthlyIndex(schedule: Schedule): number {
  const index = indexOfKey(schedule.startDate);
  const day = schedule.dayOfMonth;
  if (day === null) throw new Error("A month-based cycle needs dayOfMonth");
  const year = Math.floor(index / 12);
  return clampedDay(year, index - year * 12, day) >= schedule.startDate ? index : index + 1;
}

/** The installments of a schedule, or null when it has none (only a monthly cycle can). */
function installmentsOf(schedule: Schedule): number | null {
  return schedule.cycle === "monthly" && schedule.installmentsTotal
    ? schedule.installmentsTotal
    : null;
}

/** The last due date of a payment with installments (the Nth), or null when it never ends. */
export function lastInstallmentDue(schedule: Schedule): string | null {
  const total = installmentsOf(schedule);
  if (total === null) return null;
  const index = firstMonthlyIndex(schedule) + total - 1;
  const year = Math.floor(index / 12);
  const day = schedule.dayOfMonth;
  if (day === null) throw new Error("A month-based cycle needs dayOfMonth");
  return clampedDay(year, index - year * 12, day);
}

/**
 * The installment number (1-based) of a due date of a payment with installments, or null when
 * the payment has none or `dueOn` is not one of its N due dates.
 */
export function installmentNumber(schedule: Schedule, dueOn: string): number | null {
  const total = installmentsOf(schedule);
  if (total === null) return null;
  const number = indexOfKey(dueOn) - firstMonthlyIndex(schedule) + 1;
  return number >= 1 && number <= total && isDueDate(schedule, dueOn) ? number : null;
}

/**
 * Every due date from `from` to `to` (both included, YYYY-MM-DD) that is on or after the start
 * date, oldest first.
 */
export function dueDatesBetween(schedule: Schedule, from: string, requestedTo: string): string[] {
  const low = later(from, schedule.startDate);
  const last = lastInstallmentDue(schedule);
  const to = last !== null && last < requestedTo ? last : requestedTo;
  if (low > to) return [];
  const dates: string[] = [];
  if (schedule.cycle === "weekly") {
    if (schedule.weekday === null) throw new Error("weekly needs a weekday");
    const offset = (schedule.weekday - isoWeekday(low) + 7) % 7;
    for (let day = addDays(low, offset); day <= to; day = addDays(day, 7)) dates.push(day);
    return dates;
  }
  for (let index = indexOfKey(low); index <= indexOfKey(to); index++) {
    const due = dueInMonthIndex(schedule, index);
    if (due !== null && due >= low && due <= to) dates.push(due);
  }
  return dates;
}

/** Whether `day` is one of the payment's due dates (on or after its start). */
export function isDueDate(schedule: Schedule, day: string): boolean {
  return dueDatesBetween(schedule, day, day).length === 1;
}

/** The longest gap between two due dates of any cycle (a year), plus a month of margin. */
const SEARCH_MONTHS = 13;

/**
 * The next `count` due dates on or after `from` (and the start date), oldest first. Every cycle
 * has at least one due date in any 13 months, so the search is bounded. A payment with
 * installments may have fewer left (or none): it returns what there is.
 */
export function nextDueDates(schedule: Schedule, from: string, count: number): string[] {
  const dates: string[] = [];
  const last = lastInstallmentDue(schedule);
  let low = later(from, schedule.startDate);
  while (dates.length < count) {
    if (last !== null && low > last) break;
    const high = addDays(low, SEARCH_MONTHS * 31);
    const found = dueDatesBetween(schedule, low, high);
    if (found.length === 0) throw new Error("A schedule without due dates");
    for (const due of found) {
      if (dates.length === count) break;
      dates.push(due);
    }
    low = addDays(high, 1);
  }
  return dates;
}

/** The first due date on or after `from` (and the start date); null when installments ended. */
export function nextDueDate(schedule: Schedule, from: string): string | null {
  return nextDueDates(schedule, from, 1)[0] ?? null;
}

/** The days a pending period can be due on: the last 60 days up to the next 7 (Lima's today). */
export function pendingWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -OVERDUE_WINDOW_DAYS), to: addDays(today, UPCOMING_DAYS) };
}

/**
 * The pending periods of a payment (SPEC-finance "Pendientes"): due dates on or after its start,
 * within the last 60 days up to the next 7, with no settlement (paid or skipped), oldest first.
 */
export function pendingPeriods(
  schedule: Schedule,
  settled: ReadonlySet<string>,
  today: string,
): string[] {
  const { from, to } = pendingWindow(today);
  return dueDatesBetween(schedule, from, to).filter((due) => !settled.has(due));
}

/** The month (YYYY-MM) of a day. */
export const monthOfDay = (day: string) => day.slice(0, 7);

/**
 * The first due date on or after `from` that has no settlement (paid or skipped): the next one
 * left to pay ("Todos", "No toca este mes"). `settled` only holds past or near dates, so the
 * search ends after a few steps. Null when a payment with installments has none left.
 */
export function nextOpenDue(
  schedule: Schedule,
  from: string,
  settled: ReadonlySet<string>,
): string | null {
  let due = nextDueDate(schedule, from);
  while (due !== null && settled.has(due)) due = nextDueDate(schedule, addDays(due, 1));
  return due;
}

/**
 * The schedule moved so its first due date is the first one on or after `from`, with the same
 * dates from there on: the start becomes that due date and, for every N months, the anchor its
 * month (the counting starts at the anchor). Used when an edit or a reactivation must not reopen
 * periods before `from`. Unchanged when the start is already on or after `from`.
 */
export function startFrom<T extends Schedule>(schedule: T, from: string): T {
  if (from <= schedule.startDate) return schedule;
  const first = nextDueDate(schedule, from);
  // An ended payment with installments has nowhere to move to: it stays as it is.
  if (first === null) return schedule;
  return {
    ...schedule,
    startDate: first,
    anchorMonth:
      schedule.cycle === "every_n_months" ? Number(first.slice(5, 7)) : schedule.anchorMonth,
  };
}

/**
 * The 1-based position of `dueOn` among a monthly payment's due dates counted from its start,
 * with no upper bound (an edit of N needs it for periods past the current N). Null for other
 * cycles or a day before the first due date.
 */
export function monthlyPosition(schedule: Schedule, dueOn: string): number | null {
  if (schedule.cycle !== "monthly") return null;
  const position = indexOfKey(dueOn) - firstMonthlyIndex(schedule) + 1;
  return position >= 1 ? position : null;
}
