// Periods and pace of a goal (SPEC-goals "Decisiones": Periodos, Ritmo). Pure: no database, no
// clock (every function takes `today`, a Lima day as YYYY-MM-DD, from `ownerDateKey`), so the
// year and quarter bounds, 31-dec/1-jan, leap years and midnight are tested with plain strings.
// Client-safe (the rows compute their pace line from the day the page was read for).
import type { GoalPeriodKind } from "./goal-constants";

export type Quarter = 1 | 2 | 3 | 4;

export type GoalPeriod =
  { kind: "year"; year: number } | { kind: "quarter"; year: number; quarter: Quarter };

/** The period a goal row stores (`quarter` is only read for a quarter). */
export function periodOf(goal: {
  periodKind: GoalPeriodKind;
  year: number;
  quarter: number | null;
}): GoalPeriod {
  if (goal.periodKind === "year") return { kind: "year", year: goal.year };
  return { kind: "quarter", year: goal.year, quarter: goal.quarter as Quarter };
}

/** The quarter (1–4) a month (1–12) belongs to. */
export function quarterOfMonth(month: number): Quarter {
  return (Math.floor((month - 1) / 3) + 1) as Quarter;
}

/** The current year or quarter of a Lima day. */
export function currentPeriod(kind: GoalPeriodKind, today: string): GoalPeriod {
  const year = Number(today.slice(0, 4));
  if (kind === "year") return { kind, year };
  return { kind, year, quarter: quarterOfMonth(Number(today.slice(5, 7))) };
}

export function samePeriod(a: GoalPeriod, b: GoalPeriod): boolean {
  return (
    a.kind === b.kind &&
    a.year === b.year &&
    (a.kind === "year" || a.quarter === (b as typeof a).quarter)
  );
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The last day of a month (1–12) of a year: leap years included. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** First and last day of the period, both included, as YYYY-MM-DD. */
export function periodBounds(period: GoalPeriod): { start: string; end: string } {
  if (period.kind === "year") return { start: `${period.year}-01-01`, end: `${period.year}-12-31` };
  const firstMonth = (period.quarter - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  return {
    start: `${period.year}-${pad(firstMonth)}-01`,
    end: `${period.year}-${pad(lastMonth)}-${pad(lastDayOfMonth(period.year, lastMonth))}`,
  };
}

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to` (YYYY-MM-DD; negative when `to` is before). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Days in the period: 365 or 366 for a year, 90–92 for a quarter. */
export function periodDays(period: GoalPeriod): number {
  const { start, end } = periodBounds(period);
  return daysBetween(start, end) + 1;
}

export type PeriodPhase = "upcoming" | "current" | "past";

/** Whether the period has not started, is going on (first and last day included) or is over. */
export function periodPhase(period: GoalPeriod, today: string): PeriodPhase {
  const { start, end } = periodBounds(period);
  if (today < start) return "upcoming";
  if (today > end) return "past";
  return "current";
}

/**
 * Days elapsed in the period, today counted (the first day is 1, the last is all of them): 0
 * before it starts, every day after it ends.
 */
export function daysElapsed(period: GoalPeriod, today: string): number {
  const { start } = periodBounds(period);
  return Math.min(Math.max(daysBetween(start, today) + 1, 0), periodDays(period));
}

/** Days still to go, today counted (the last day is 1): every day before it starts, 0 after. */
export function daysLeft(period: GoalPeriod, today: string): number {
  const phase = periodPhase(period, today);
  if (phase === "upcoming") return periodDays(period);
  if (phase === "past") return 0;
  return daysBetween(today, periodBounds(period).end) + 1;
}

/** `target × elapsed / days` (SPEC-goals "Ritmo"): where the goal would be at an even pace. */
export function expectedProgress(target: number, period: GoalPeriod, today: string): number {
  return (target * daysElapsed(period, today)) / periodDays(period);
}

/**
 * The tolerance around the expected progress: one unit, or 5 % of the target when that is more
 * (a goal of 200 days isn't "ahead" for a single day).
 */
export function paceTolerance(target: number): number {
  return Math.max(1, target * 0.05);
}

export type Pace =
  /** The target is reached. */
  | { kind: "done" }
  /** The period has not started. */
  | { kind: "upcoming" }
  /** The period is over and the target was not reached: its final value, no judgement. */
  | { kind: "past" }
  /** At least a tolerance above the expected progress: `by` whole units. */
  | { kind: "ahead"; by: number }
  /** Within the tolerance of the expected progress. */
  | { kind: "on" }
  /** Below it: only the next step, never a debt (`perWeekNeeded` rounded up, 1 at least). */
  | { kind: "next-step"; perWeekNeeded: number; remaining: number };

/**
 * The pace of a goal at `value` of `target` on `today` (SPEC-goals "Ritmo"). Under the expected
 * progress it only says what it takes from now on: `ceil(remaining / weeks left)`, with at least
 * one week (the last days ask for the week's worth, not an impossible daily rate).
 */
export function paceOf(args: {
  value: number;
  target: number;
  period: GoalPeriod;
  today: string;
}): Pace {
  const { value, target, period, today } = args;
  if (value >= target) return { kind: "done" };
  const phase = periodPhase(period, today);
  if (phase === "upcoming") return { kind: "upcoming" };
  if (phase === "past") return { kind: "past" };
  const expected = expectedProgress(target, period, today);
  const tolerance = paceTolerance(target);
  if (value >= expected + tolerance) return { kind: "ahead", by: Math.floor(value - expected) };
  if (value >= expected - tolerance) return { kind: "on" };
  const remaining = target - value;
  const weeksLeft = Math.max(1, daysLeft(period, today) / 7);
  return {
    kind: "next-step",
    perWeekNeeded: Math.max(1, Math.ceil(remaining / weeksLeft)),
    remaining,
  };
}

/** "2026" or "T4 2026". */
export function periodLabel(period: GoalPeriod): string {
  return period.kind === "year" ? String(period.year) : `T${period.quarter} ${period.year}`;
}
