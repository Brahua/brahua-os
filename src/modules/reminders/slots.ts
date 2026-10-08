// Pure: when each reminder is due and whether it still can go out (SPEC-reminders "Motor de
// avisos"). The owner's day is America/Lima, UTC-5 all year (no daylight saving), so every instant
// is computed by arithmetic, never with Intl, like `src/lib/natural-date.ts`.
import { GRACE_WINDOW_MS } from "./reminders-constants";

/** Lima = UTC-5: a Lima wall-clock time is the UTC instant five hours later. */
const LIMA_UTC_OFFSET_HOURS = 5;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** The owner's day of an instant, YYYY-MM-DD. */
export function limaDayOf(instant: Date): string {
  return new Date(instant.getTime() - LIMA_UTC_OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10);
}

/** `HH:MM` (or `HH:MM:SS`, as Postgres' `time` returns it) → minutes since midnight; null if invalid. */
export function minutesOfTime(time: string): number | null {
  const match = TIME.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Postgres' `07:30:00` → `07:30` (the settings have no seconds). */
export function toHourMinute(time: string): string {
  return time.slice(0, 5);
}

/** A day key moved by whole days (`2026-10-31` + 1 → `2026-11-01`). Invalid keys throw. */
export function addDaysToKey(dayKey: string, days: number): string {
  const match = DAY_KEY.exec(dayKey);
  if (!match) throw new Error(`Invalid day key: ${dayKey}`);
  const moved = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return moved.toISOString().slice(0, 10);
}

/**
 * The instant at which `time` (Lima, `HH:MM`) happens on the Lima day `dayKey`. 23:59 is still
 * that day; 00:00 is its very start (the night before in UTC). Invalid input throws.
 */
export function limaInstant(dayKey: string, time: string): Date {
  const day = DAY_KEY.exec(dayKey);
  const minutes = minutesOfTime(time);
  if (!day || minutes === null) throw new Error(`Invalid slot: ${dayKey} ${time}`);
  const midnightUtc = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  return new Date(midnightUtc + LIMA_UTC_OFFSET_HOURS * HOUR_MS + minutes * MINUTE_MS);
}

/** The morning briefing of a day, at `briefingTime`. */
export function briefingSlot(dayKey: string, briefingTime: string): Date {
  return limaInstant(dayKey, briefingTime);
}

/** The eve of a payment: the day before it is due, at `briefingTime`. */
export function paymentEveSlot(dueOn: string, briefingTime: string): Date {
  return limaInstant(addDaysToKey(dueOn, -1), briefingTime);
}

/** The single follow-up of a payment still pending: 3 days after it was due, at `briefingTime`. */
export function paymentFollowupSlot(dueOn: string, briefingTime: string): Date {
  return limaInstant(addDaysToKey(dueOn, 3), briefingTime);
}

/** The evening review of a day, at `eveningTime`. */
export function eveningReviewSlot(dayKey: string, eveningTime: string): Date {
  return limaInstant(dayKey, eveningTime);
}

/** A habit's own time on a day. */
export function habitTimeSlot(dayKey: string, reminderTime: string): Date {
  return limaInstant(dayKey, reminderTime);
}

/** Where `now` is relative to a reminder's window `[dueAt, dueAt + 2 h)`. */
export type WindowState = "early" | "open" | "expired";

export function windowState(
  dueAt: Date,
  now: Date,
  graceMs: number = GRACE_WINDOW_MS,
): WindowState {
  const due = dueAt.getTime();
  const at = now.getTime();
  if (at < due) return "early";
  return at < due + graceMs ? "open" : "expired";
}
