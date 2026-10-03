// What `habits` offers other modules (H6, SPEC-habits "Contratos"), server-only. Every read
// checks the owner (redirects to /login without one) and filters with `activeHabit` and
// `ofVisibleHabit` (habits.ts), like the module's own screens:
//
// - getHabitsTodaySummary(now) (for `today`): the habits due today (Lima) and not paused today,
//   in the manual order, with today's state. Three queries whatever the number of habits (the
//   habits with today's log, the logs the streak rules need, the pauses: `selectItems`).
// - getHabitsWeekSummary(weekStart, now) (for `weekly-review`): a week's compliance per habit and
//   its total ("18 de 24"), the rows of the "Semana" view (`selectHabitsWeek`, three queries).
//
// To log from `today`: the client component `HabitPad`, the actions of log-actions.ts and the
// hooks `useDayLog`/`useQuantityLog` inside `HabitsScreenWithin` (the host's queue, notices and
// announcer through `ScreenServicesContext`). Link with `habitPath(id)` (routes.ts).
import "server-only";
import { and, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { habits } from "./db/schema";
import { activeHabit, selectItems } from "./habits";
import { selectHabitsWeek } from "./history";
import { weekStart as mondayOf } from "./schedule";
import { buildHabitsTodaySummary, type HabitTodayItem } from "./today-summary";
import { buildHabitsWeekSummary, type HabitsWeekSummary } from "./week-summary";

export type { HabitTodayArea, HabitTodayItem } from "./today-summary";
export type { HabitWeekSummaryItem, HabitsWeekSummary } from "./week-summary";

/**
 * The summary's habits: active, started by today (Lima's day of `now`), with today's log, in their
 * manual order; then the pure rules keep the ones due today and not paused. Three queries (one
 * without habits). Trusts its caller (see getHabitsTodaySummary).
 */
export async function selectHabitsTodaySummary(
  db: Database,
  now: Date,
): Promise<HabitTodayItem[]> {
  const today = ownerDateKey(now);
  const started = and(activeHabit, lte(habits.startDate, today)) as SQL;
  return buildHabitsTodaySummary(await selectItems(db, today, started), now);
}

/**
 * For `today`: the habits due today (Lima) and not paused today, in their manual order, with
 * today's quantity, whether today is met, the week ("X veces por semana") and the streak. Checks
 * the owner like the other queries (redirects to /login without one).
 */
export async function getHabitsTodaySummary(now: Date): Promise<HabitTodayItem[]> {
  await requireOwner();
  return selectHabitsTodaySummary(getDb(), now);
}

const day = z.iso.date();

/**
 * A week's summary (the week of `weekStart`, any day of it) as of `now`. A week after the current
 * one, or before the first active habit started, has no habits: it is empty (never another week's
 * numbers). Trusts its caller (see getHabitsWeekSummary).
 */
export async function selectHabitsWeekSummary(
  db: Database,
  weekStart: string,
  now: Date,
): Promise<HabitsWeekSummary> {
  if (!day.safeParse(weekStart).success) {
    throw new RangeError("weekStart must be a day as YYYY-MM-DD");
  }
  const monday = mondayOf(weekStart);
  const week = await selectHabitsWeek(db, ownerDateKey(now), monday);
  // "Semana" keeps its `?semana=` within the weeks there are; a summary says nothing instead.
  if (week.monday !== monday) return buildHabitsWeekSummary(monday, []);
  return buildHabitsWeekSummary(monday, week.rows);
}

/**
 * For `weekly-review`: each active habit's compliance in the week of `weekStart` (any day of it;
 * the summary names its Monday) and the total ("18 de 24"), with the rules of the "Semana" view
 * (SPEC-habits "Rachas y cumplimiento"). The current week counts up to today. Checks the owner.
 */
export async function getHabitsWeekSummary(
  weekStart: string,
  now: Date = new Date(),
): Promise<HabitsWeekSummary> {
  await requireOwner();
  return selectHabitsWeekSummary(getDb(), weekStart, now);
}
