// The line under the greeting of "/" (greeting-variants, corte `polish`): pure and client-safe.
// It reads the same live tally as "Día completo" and the part of the Lima day the server computed
// (`dayPartFor`), so `evening-close-ritual` can reuse both (`dayState`, `DayPart`).
import type { DayPart } from "@/lib/time";
import { isDayComplete, variantForDay, type DayTally } from "./today-board";
import { TODAY_COPY } from "./today-copy";

/**
 * Where the day stands: nothing done, something done, everything done (`isDayComplete`) or
 * nothing at all to do or done (the empty day).
 */
export type DayState = "none" | "some" | "all" | "empty";

export function dayState(tally: DayTally): DayState {
  if (isDayComplete(tally)) return "all";
  const { habits, tasks, payments } = tally;
  if (habits.active > 0 || tasks.doneToday > 0) return "some";
  const nothingDue =
    habits.total === 0 && tasks.pending === 0 && tasks.doneToday === 0 && !payments?.blocking;
  return nothingDue ? "empty" : "none";
}

/** Things the day holds and are not done: habits not met, tasks and payments due. */
export function openThings({ habits, tasks, payments }: DayTally): number {
  return Math.max(0, habits.total - habits.done) + tasks.pending + (payments?.blocking ?? 0);
}

/** Whether a Lima day (YYYY-MM-DD) is a Monday. */
export function isMonday(day: string): boolean {
  return new Date(`${day}T12:00:00Z`).getUTCDay() === 1;
}

export type GreetingVariant = string | ((count: number) => string);

/** Every variant that can show for a part and state on a day (the pool `variantForDay` picks from). */
export function greetingPool(
  part: DayPart,
  state: DayState,
  { monday, count }: { monday: boolean; count: number },
): GreetingVariant[] {
  if (state === "all" || state === "empty") return [];
  const lines = TODAY_COPY.greetingLines;
  const base: readonly GreetingVariant[] = lines[state][part];
  const pool = count >= 1 ? [...base] : base.filter((variant) => typeof variant === "string");
  if (state === "none" && monday) pool.push(...lines.mondayNone);
  return pool;
}

/**
 * The second line under the greeting, or null (a finished or an empty day already has its own
 * block, and says it). The same part, state and day always give the same line.
 */
export function greetingLine(input: {
  part: DayPart;
  tally: DayTally;
  today: string;
}): string | null {
  const state = dayState(input.tally);
  const count = openThings(input.tally);
  const pool = greetingPool(input.part, state, { monday: isMonday(input.today), count });
  if (pool.length === 0) return null;
  const variant = pool[variantForDay(input.today, pool.length)];
  return typeof variant === "string" ? variant : variant(count);
}
