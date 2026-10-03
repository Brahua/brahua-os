// H5: the "Semana" view of /habits (SPEC-habits "Pantallas"): each active habit's 7 days and its
// compliance, and the week's total ("18 de 24 esta semana"). Pure and client-safe: the server
// builds the rows with these (history.ts), and `getHabitsWeekSummary` (weekly-review) can too.
import type { HabitKind, HabitMeasure } from "./habit-constants";
import type { HabitAreaSummary } from "./habit-input";
import { weekStart } from "./schedule";
import {
  dayStatus,
  weekCompliance,
  weekDays,
  type Compliance,
  type DayStatus,
  type StreakHistory,
  type StreakRules,
} from "./streak";

/** One day of a habit's week: its state and what was logged (0 without a log). */
export type HabitWeekDay = {
  day: string;
  status: DayStatus;
  quantity: number;
  target: number;
};

/** A habit's row in "Semana". */
export type HabitWeekRow = {
  id: string;
  name: string;
  kind: HabitKind;
  measure: HabitMeasure;
  unit: string | null;
  area: HabitAreaSummary | null;
  /** "5 de 7", "2 de 3" (`weekCompliance`). */
  compliance: Compliance;
  /** Monday to Sunday. */
  days: HabitWeekDay[];
};

/** What a row needs of a habit besides its rules. */
export type HabitWeekHabit = StreakRules & {
  id: string;
  name: string;
  measure: HabitMeasure;
  goal: number;
  unit: string | null;
  area: HabitAreaSummary | null;
};

/** A habit's row for the week of `monday` (its history must hold that week's logs). */
export function habitWeekRow(
  habit: HabitWeekHabit,
  history: StreakHistory,
  monday: string,
  today: string,
): HabitWeekRow {
  return {
    id: habit.id,
    name: habit.name,
    kind: habit.kind,
    measure: habit.measure,
    unit: habit.unit,
    area: habit.area,
    compliance: weekCompliance(habit, history, monday, today),
    days: weekDays(monday).map((day) => {
      const log = history.logs.get(day);
      return {
        day,
        status: dayStatus(habit, history, day, today),
        quantity: log?.quantity ?? 0,
        target: log?.target ?? habit.goal,
      };
    }),
  };
}

/**
 * The week's total ("18 de 24 esta semana"): what was done over what was expected, summed over
 * the habits (SPEC-habits "Total de la semana"; the base of `getHabitsWeekSummary`).
 */
export function weekTotal(rows: readonly { compliance: Compliance }[]): Compliance {
  return rows.reduce(
    (total, row) => ({
      done: total.done + row.compliance.done,
      expected: total.expected + row.compliance.expected,
    }),
    { done: 0, expected: 0 },
  );
}

/**
 * The Monday of the week a page shows: `?semana=` when it is a real day (its week), kept between
 * the week of the earliest start date and the current one; else the current week.
 */
export function parseWeekParam(
  value: string | string[] | undefined,
  today: string,
  earliestStart: string | null,
): string {
  const current = weekStart(today);
  if (typeof value !== "string" || !isRealDay(value)) return current;
  const monday = weekStart(value);
  if (monday > current) return current;
  const first = earliestStart && earliestStart < today ? weekStart(earliestStart) : current;
  return monday < first ? first : monday;
}

function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** How many dots a day of a habit shows in the week's `DotMatrix`, and how many are lit. */
export type DayDots = { total: number; done: number; complete: boolean };

/** At most one 3 × 3 block of dots per day. */
const DOTS_MAX = 9;

/**
 * The dots of a day: one for a yes/no (and a habit to avoid: lit while clean), and for a quantity
 * one per unit up to 9 (more: 9, lit in proportion, all of them only at the goal). Lit in signal
 * orange once the day is done. A day that doesn't count (paused, not scheduled, before the start)
 * shows no dots at all, so it never looks like a day not met; one still to come shows them unlit.
 */
export function dayDots(
  habit: { kind: HabitKind; measure: HabitMeasure },
  day: Pick<HabitWeekDay, "status" | "quantity" | "target">,
): DayDots {
  if (day.status === "paused" || day.status === "notScheduled" || day.status === "beforeStart") {
    return { total: 0, done: 0, complete: false };
  }
  const quantity = habit.kind === "build" && habit.measure === "quantity";
  const total = quantity ? Math.min(Math.max(day.target, 1), DOTS_MAX) : 1;
  if (day.status === "done") return { total, done: total, complete: true };
  if (day.status === "partial" && quantity) {
    const reached = Math.min(day.quantity, day.target);
    return { total, done: Math.floor((reached * total) / day.target), complete: false };
  }
  return { total, done: 0, complete: false };
}
