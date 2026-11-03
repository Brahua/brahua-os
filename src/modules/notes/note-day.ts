// Days of the daily notes (SPEC-notes "Pantallas"): pure, client-safe. A day is a Lima calendar
// day written `YYYY-MM-DD`; it has no time zone, so it is read and written as UTC and never shifts.
import { NOTE_DAY_MIN } from "./note-constants";

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` is a real calendar day written `YYYY-MM-DD` (2026-02-30 is not). */
export function isDayKey(value: string): boolean {
  const match = DAY_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Whether a daily note may be written for `day` when Lima's today is `today`: a real day, not in
 * the future, and not before the first day the table accepts. (`YYYY-MM-DD` compares as text.)
 */
export function isWritableDay(day: string, today: string): boolean {
  return isDayKey(day) && day <= today && day >= NOTE_DAY_MIN;
}

/** `day` moved `amount` days (negative: back). */
export function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10);
}

/** What a note's URL names: a daily note's day, a knowledge note's id, or nothing valid. */
export type NoteKey = { kind: "daily"; day: string } | { kind: "page"; id: string };

/**
 * Reads `/notes/[key]`: a day (`YYYY-MM-DD`) that may be written today, or a uuid. A future or
 * malformed day, or anything else, is null (the page is a 404).
 */
export function parseNoteKey(key: string, today: string): NoteKey | null {
  if (DAY_PATTERN.test(key)) return isWritableDay(key, today) ? { kind: "daily", day: key } : null;
  if (UUID_PATTERN.test(key)) return { kind: "page", id: key.toLowerCase() };
  return null;
}

const WEEKDAY_DAY_MONTH = new Intl.DateTimeFormat("es-PE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const WEEKDAY_DAY_MONTH_YEAR = new Intl.DateTimeFormat("es-PE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * A daily note's title: «Lunes 3 de noviembre» (with the year when it isn't `today`'s year:
 * «Viernes 31 de octubre de 2025»).
 */
export function dailyTitle(day: string, today: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const format = day.slice(0, 4) === today.slice(0, 4) ? WEEKDAY_DAY_MONTH : WEEKDAY_DAY_MONTH_YEAR;
  // es-PE writes «lunes, 3 de noviembre»: no comma after the weekday, capitalized.
  const text = format.format(date).replace(",", "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whole days from `day` to `today` (both `YYYY-MM-DD`): 0 today, 1 yesterday. */
export function daysBetween(day: string, today: string): number {
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000,
  );
}
