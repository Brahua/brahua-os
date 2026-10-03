// H5: the habit page's monthly calendar (SPEC-habits "Detalle"). Pure and client-safe: the month
// in the URL (`?mes=YYYY-MM`), the grid (Monday first) and its keyboard navigation. Days are
// Lima's (YYYY-MM-DD), like everywhere in `habits`.
import { addDays, isoWeekday } from "./schedule";
import { monthDays } from "./streak";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The month (`YYYY-MM`) of a day. */
export const monthOf = (day: string) => day.slice(0, 7);

/** The month `months` after `month` (negative: before), across years. */
export function addMonths(month: string, months: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + months;
  const nextYear = Math.floor(index / 12);
  return `${String(nextYear).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The last day of a month. */
export const monthEnd = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

/**
 * The month a page shows: `?mes=` when it is a real month between the habit's first month and
 * today's (anything earlier or later is moved inside), else today's month.
 */
export function parseMonthParam(
  value: string | string[] | undefined,
  today: string,
  startDate: string,
): string {
  const last = monthOf(today);
  const first = startDate < today ? monthOf(startDate) : last;
  if (typeof value !== "string" || !MONTH_PATTERN.test(value)) return last;
  if (value > last) return last;
  if (value < first) return first;
  return value;
}

/** The previous and next months a page links to (null: none, before the start or after today). */
export function monthLinks(month: string, today: string, startDate: string) {
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);
  return {
    previous: previous >= monthOf(startDate) ? previous : null,
    next: next <= monthOf(today) ? next : null,
  };
}

/**
 * The month as weeks of 7 cells, Monday first: each a day of the month or null (the days of the
 * months around it are left empty).
 */
export function monthGrid(month: string): (string | null)[][] {
  const days = monthDays(month);
  const cells: (string | null)[] = [
    ...Array.from({ length: isoWeekday(days[0]) - 1 }, () => null),
    ...days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

/** What a key does in the calendar grid. */
export type GridKey = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

/**
 * Where focus goes from `day` with a key (the grid pattern, as in a date picker): ← → a day,
 * ↑ ↓ a week, Home/End the start or end of its week, Ctrl/⌘ + Home/End the month's first or last
 * day. Never outside the month (an arrow past its edge stays put). Null for any other key (the
 * browser keeps it).
 */
export function moveInMonth(day: string, month: string, { key, ctrlKey, metaKey }: GridKey) {
  const first = `${month}-01`;
  const last = monthEnd(month);
  const inside = (target: string) => (target < first ? first : target > last ? last : target);
  const keep = (target: string) => (target < first || target > last ? day : target);
  switch (key) {
    case "ArrowLeft":
      return keep(addDays(day, -1));
    case "ArrowRight":
      return keep(addDays(day, 1));
    case "ArrowUp":
      return keep(addDays(day, -7));
    case "ArrowDown":
      return keep(addDays(day, 7));
    case "Home":
      return ctrlKey || metaKey ? first : inside(addDays(day, 1 - isoWeekday(day)));
    case "End":
      return ctrlKey || metaKey ? last : inside(addDays(day, 7 - isoWeekday(day)));
    default:
      return null;
  }
}
