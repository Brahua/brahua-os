// Due dates of recurring payments (SPEC-finance "Ciclos", "Vencimientos", "Pendientes"). Pure and
// client-safe: every day is a YYYY-MM-DD key of Lima's calendar, read as a UTC midnight so nothing
// depends on the host's time zone; "today" is always passed in (`ownerDateKey(now)`).
//
// The four cycles:
// - weekly: every ISO weekday `weekday` (1 = Monday … 7 = Sunday);
// - monthly: day `dayOfMonth` (1–31) of every month, clamped to the month's end (31 → Feb 28/29,
//   Apr 30), like tasks' "el día X del mes" (T3);
// - every_n_months: day `dayOfMonth` (clamped) every `intervalMonths` (2–12) months, counted from
//   `anchorMonth` of the start date's year (decisión autónoma: with an interval that doesn't divide
//   12, e.g. 5, the anchor month alone is ambiguous across years; the start's year fixes it);
// - yearly: day `dayOfMonth` of `anchorMonth` (Feb 29 → Feb 28 in a non-leap year).
// Only due dates on or after `startDate` count (the first period is the first due date ≥ it).
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
      const anchorIndex = monthIndex(Number(schedule.startDate.slice(0, 4)), anchor - 1);
      if ((((index - anchorIndex) % interval) + interval) % interval !== 0) return null;
      break;
    }
    case "yearly":
      if (schedule.anchorMonth === null) throw new Error("yearly needs anchorMonth");
      if (month0 !== schedule.anchorMonth - 1) return null;
      break;
    case "weekly":
      throw new Error("weekly is not month-based");
  }
  return `${year}-${pad(month0 + 1)}-${pad(Math.min(day, daysInMonth(year, month0)))}`;
}

function indexOfKey(day: string): number {
  return monthIndex(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1);
}

/** The later of two keys. */
const later = (a: string, b: string) => (a > b ? a : b);

/**
 * Every due date from `from` to `to` (both included, YYYY-MM-DD) that is on or after the start
 * date, oldest first.
 */
export function dueDatesBetween(schedule: Schedule, from: string, to: string): string[] {
  const low = later(from, schedule.startDate);
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
 * has at least one due date in any 13 months, so the search is bounded.
 */
export function nextDueDates(schedule: Schedule, from: string, count: number): string[] {
  const dates: string[] = [];
  let low = later(from, schedule.startDate);
  while (dates.length < count) {
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

/** The first due date on or after `from` (and the start date). */
export function nextDueDate(schedule: Schedule, from: string): string {
  return nextDueDates(schedule, from, 1)[0];
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
