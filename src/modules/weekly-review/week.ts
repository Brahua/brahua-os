// The week of the ritual (SPEC-weekly-review "Decisiones": Qué semana, Invitación). Pure and
// client-safe: no database, no clock (every function takes the instant, `now`, or a Lima day as
// YYYY-MM-DD), so Sunday 17:59, Monday 23:59, the Lima midnight (05:00 UTC), month and year
// changes and leap years are tested with plain values.
//
// A week is Monday to Sunday in America/Lima and is keyed by its Monday (`weekly_reviews.week_start`).
// The day helpers live here (not imported from `habits` or `goals`: this module reads those only
// through their contracts, see eslint.config.mjs). Lima has no daylight saving, so «18:00» and
// «23:59» are fixed wall-clock hours.
import { ownerDateKey, ownerHour } from "@/lib/time";

const DAY_MS = 86_400_000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The invitation opens on Sunday at this Lima hour (18:00). */
export const INVITE_FROM_HOUR = 18;

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** `day` moved by `days` (negative: earlier), across months and years. */
export function addDays(day: string, days: number): string {
  return new Date(toDate(day).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whether `value` is a real calendar day written YYYY-MM-DD (no 2026-02-30, no 2026-1-5). */
export function isDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const date = toDate(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** ISO weekday of a day: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const weekday = toDate(day).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Whether `value` is a real day that falls on a Monday. */
export function isMonday(value: string): boolean {
  return isDateKey(value) && isoWeekday(value) === 1;
}

/** The Monday of the week `day` (a Lima day) is in. */
export function mondayOf(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

/** The Sunday that ends the week starting on `weekStart`. */
export function sundayOf(weekStart: string): string {
  return addDays(weekStart, 6);
}

/** The Monday after the week starting on `weekStart`. */
export function nextMonday(weekStart: string): string {
  return addDays(weekStart, 7);
}

/** The Monday before the week starting on `weekStart`. */
export function previousMonday(weekStart: string): string {
  return addDays(weekStart, -7);
}

/** The Monday of the week Lima is in at `now`. */
export function currentWeekStart(now: Date): string {
  return mondayOf(ownerDateKey(now));
}

/**
 * The week the ritual opens on by default: the week in progress; but on Monday and Tuesday, the
 * previous one while it has no review (the owner closes the week that just ended the day after).
 * `previousWeekReviewed` is whether `weekly_reviews` has a row for the previous week.
 */
export function defaultReviewWeek(now: Date, previousWeekReviewed: boolean): string {
  const today = ownerDateKey(now);
  const current = mondayOf(today);
  if (isoWeekday(today) <= 2 && !previousWeekReviewed) return previousMonday(current);
  return current;
}

/**
 * `?semana=` of /review: a Monday that is not in the future (the week in progress or an earlier
 * one). Anything else (a missing, malformed or repeated value, a day that is not a Monday, a
 * week that hasn't started) is null and the page falls back to the default week.
 */
export function parseWeekParam(value: string | string[] | undefined, now: Date): string | null {
  if (typeof value !== "string" || !isMonday(value)) return null;
  return value <= currentWeekStart(now) ? value : null;
}

/** Whether `weekStart` can be reviewed now: a Monday, the week in progress or an earlier one. */
export function isReviewableWeek(weekStart: string, now: Date): boolean {
  return parseWeekParam(weekStart, now) !== null;
}

/**
 * The week the invitation offers at `now`, by the clock alone (Lima): from Sunday 18:00 the week
 * that ends that Sunday, and on Monday (to 23:59) the week that ended yesterday; null the rest of
 * the time (Tuesday 00:00 on). Whether that week is already closed is the caller's to say
 * (`reviewInvite`).
 */
export function inviteWeek(now: Date): string | null {
  const today = ownerDateKey(now);
  const weekday = isoWeekday(today);
  if (weekday === 7 && ownerHour(now) >= INVITE_FROM_HOUR) return mondayOf(today);
  if (weekday === 1) return previousMonday(today);
  return null;
}

/** The invitation's week, or null outside the window or when that week is already closed. */
export function reviewInvite(now: Date, weekClosed: boolean): { weekStart: string } | null {
  const weekStart = inviteWeek(now);
  return weekStart === null || weekClosed ? null : { weekStart };
}

/**
 * Where "Mover las N al lunes" and "Mañana" land when reviewing `weekStart` at `now`.
 *
 * - `monday`: the Monday after the reviewed week; if that Monday is already behind us (an old
 *   week), the first Monday that is today or later.
 * - `tomorrow`: tomorrow; once the reviewed week is over (its Sunday is before today) there is no
 *   «mañana» of that week to speak of, so it is the same Monday.
 */
export function moveTargets(weekStart: string, now: Date): { monday: string; tomorrow: string } {
  const today = ownerDateKey(now);
  let monday = nextMonday(weekStart);
  if (monday < today) {
    const nextOnOrAfter = mondayOf(today) === today ? today : nextMonday(mondayOf(today));
    monday = nextOnOrAfter;
  }
  const tomorrow = sundayOf(weekStart) < today ? monday : addDays(today, 1);
  return { monday, tomorrow };
}

// ── Labels ─────────────────────────────────────────────────────────────────────────────────

const MONTH_FORMAT = new Intl.DateTimeFormat("es-PE", { month: "long", timeZone: "UTC" });

// ICU for es-PE can capitalize the month on its own ("Setiembre"): always lowercase in a sentence.
const monthName = (day: string) => MONTH_FORMAT.format(toDate(day)).toLowerCase();
const dayNumber = (day: string) => Number(day.slice(8, 10));
const yearOf = (day: string) => day.slice(0, 4);

/**
 * The week as a range: "12 al 18 de octubre", "28 de setiembre al 4 de octubre", and with the
 * years when it crosses one: "28 de diciembre de 2026 al 3 de enero de 2027".
 */
export function weekRange(weekStart: string): string {
  const end = sundayOf(weekStart);
  if (yearOf(weekStart) !== yearOf(end)) {
    return `${dayNumber(weekStart)} de ${monthName(weekStart)} de ${yearOf(weekStart)} al ${dayNumber(end)} de ${monthName(end)} de ${yearOf(end)}`;
  }
  if (monthName(weekStart) !== monthName(end)) {
    return `${dayNumber(weekStart)} de ${monthName(weekStart)} al ${dayNumber(end)} de ${monthName(end)}`;
  }
  return `${dayNumber(weekStart)} al ${dayNumber(end)} de ${monthName(end)}`;
}

/** «Del 12 al 18 de octubre»: the heading of a week. */
export function weekLabel(weekStart: string): string {
  return `Del ${weekRange(weekStart)}`;
}
