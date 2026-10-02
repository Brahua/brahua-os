// Recurrence of tasks (T3, SPEC-tasks "Recurrencia"): the next due date and the rule in words.
// Pure and client-safe: the instant is explicit and every calendar step happens on Lima's day
// (`ownerDateKey`), so nothing depends on the host's time zone. Lima has no DST (UTC−5 all
// year), but nothing here relies on that: days are counted on YYYY-MM-DD keys read as UTC.
import { ownerDateKey } from "@/lib/time";
import type { TaskRecurrence } from "./task-input";

/** A YYYY-MM-DD key as a UTC midnight (a calendar day without a time zone). */
function parseKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

/** A UTC midnight as its YYYY-MM-DD key. */
function toKey(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** Days in a month (`month` 0–11), leap years included. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addDays(day: Date, days: number): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + days));
}

/** N months later, clamped to the month's end (Jan 31 + 1 month = Feb 28, or 29 in a leap year). */
function addMonths(day: Date, months: number): Date {
  const total = day.getUTCMonth() + months;
  const year = day.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  return new Date(Date.UTC(year, month, Math.min(day.getUTCDate(), daysInMonth(year, month))));
}

/** ISO weekday of a UTC midnight: 1 = Monday … 7 = Sunday. */
function isoWeekday(day: Date): number {
  return day.getUTCDay() === 0 ? 7 : day.getUTCDay();
}

/**
 * The due date (YYYY-MM-DD) of the occurrence that follows one completed at `completedAt`:
 * - every N days / weeks / months: counted from the completion day in Lima (months clamp to
 *   the month's end);
 * - some weekdays, or day X of the month (clamped to the month's end): the first day that fits,
 *   from tomorrow on (Lima).
 */
export function nextDueDate(rule: TaskRecurrence, completedAt: Date): string {
  const today = parseKey(ownerDateKey(completedAt));
  switch (rule.kind) {
    case "every_days":
      return toKey(addDays(today, requireInterval(rule)));
    case "every_weeks":
      return toKey(addDays(today, requireInterval(rule) * 7));
    case "every_months":
      return toKey(addMonths(today, requireInterval(rule)));
    case "weekdays": {
      const days = new Set(rule.weekdays ?? []);
      if (days.size === 0) throw new Error("A weekdays rule needs at least one day");
      // Within 7 days from tomorrow every weekday appears once.
      for (let offset = 1; offset <= 7; offset++) {
        const candidate = addDays(today, offset);
        if (days.has(isoWeekday(candidate))) return toKey(candidate);
      }
      throw new Error("Weekdays out of range (ISO 1–7)");
    }
    case "month_day": {
      const target = rule.monthDay;
      if (target === null || target < 1 || target > 31) throw new Error("Day of month out of range");
      const tomorrow = addDays(today, 1);
      const dayIn = (year: number, month: number) =>
        new Date(Date.UTC(year, month, Math.min(target, daysInMonth(year, month))));
      // Tomorrow's month's (clamped) day if it is not past, else the next month's.
      const sameMonth = dayIn(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth());
      if (sameMonth >= tomorrow) return toKey(sameMonth);
      return toKey(dayIn(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1));
    }
  }
}

function requireInterval(rule: TaskRecurrence): number {
  const interval = rule.interval;
  if (interval === null || !Number.isInteger(interval) || interval < 1) {
    throw new Error("An every_* rule needs an interval ≥ 1");
  }
  return interval;
}

// ── The rule in words (Spanish) ────────────────────────────────────────────────────────────────

/** ISO weekday names, plural as they read in "Los lunes y jueves". */
export const WEEKDAY_PLURALS: Record<number, string> = {
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábados",
  7: "domingos",
};

/** ISO weekday names, singular and capitalized (the toggles' accessible names). */
export const WEEKDAY_NAMES: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

/** One-letter initials of the toggles (Spanish calendars: L M X J V S D). */
export const WEEKDAY_INITIALS: Record<number, string> = {
  1: "L",
  2: "M",
  3: "X",
  4: "J",
  5: "V",
  6: "S",
  7: "D",
};

/** "a", "a y b", "a, b y c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

const SINCE = "desde que la completas";

/** [one, many] of each interval unit. */
const UNITS: Record<"every_days" | "every_weeks" | "every_months", [string, string]> = {
  every_days: ["día", "días"],
  every_weeks: ["semana", "semanas"],
  every_months: ["mes", "meses"],
};

/**
 * The rule in words: "Cada 3 días desde que la completas", "Cada semana desde que la completas",
 * "Los lunes y jueves", "De lunes a viernes", "Todos los días", "El día 15 de cada mes", "El
 * último día de cada mes".
 */
export function recurrenceSummary(rule: TaskRecurrence): string {
  switch (rule.kind) {
    case "every_days":
    case "every_weeks":
    case "every_months": {
      const [one, many] = UNITS[rule.kind];
      const n = rule.interval ?? 1;
      return n === 1 ? `Cada ${one} ${SINCE}` : `Cada ${n} ${many} ${SINCE}`;
    }
    case "weekdays": {
      const days = [...new Set(rule.weekdays ?? [])].sort((a, b) => a - b);
      if (days.length === 7) return "Todos los días";
      if (days.join() === "1,2,3,4,5") return "De lunes a viernes";
      return `Los ${listOf(days.map((day) => WEEKDAY_PLURALS[day]))}`;
    }
    case "month_day": {
      const day = rule.monthDay ?? 1;
      if (day === 31) return "El último día de cada mes";
      if (day >= 29) return `El día ${day} de cada mes (o el último, si el mes es más corto)`;
      return `El día ${day} de cada mes`;
    }
  }
}
