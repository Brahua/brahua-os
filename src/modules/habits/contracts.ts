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
// - getHabitsDueToday(now) (for `today`'s pads): the same habits as full `HabitItem`s.
//
// - getHabitDoneDays(habitId, from, to) (for `goals`): a habit's days done in a range, with the
//   rules of the streaks (pauses and not scheduled days out of the count). `selectHabitsDoneDays`
//   reads many goals' habits in three queries; `getHabitOptions` lists the active habits a goal
//   can follow.
//
// To log from `today`: getHabitsDueToday, then the client component `HabitPad`, the actions of
// log-actions.ts and the hooks `useDayLog`/`useQuantityLog` inside `HabitsScreenWithin` (the
// host's queue, notices and announcer through `ScreenServicesContext`; `areas` only feeds the
// create form, which a pad never opens: `[]` is fine). Link with `habitPath(id)` (routes.ts).
import "server-only";
import { and, inArray, isNotNull, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { habits } from "./db/schema";
import { doneDaysIn, type HabitDoneDays } from "./done-days";
import { activeHabit, selectItems, selectPauses, visibleHabit, type Tx } from "./habits";
import { selectHabitsWeek, selectLogsInRange } from "./history";
import { weekStart as mondayOf } from "./schedule";
import type { HabitItem } from "./habit-input";
import {
  buildHabitsTodaySummary,
  habitsDueToday,
  timedHabitsLeft,
  type HabitTodayItem,
  type TimedHabit,
} from "./today-summary";
import { buildHabitsWeekSummary, type HabitsWeekSummary } from "./week-summary";

export type { HabitDoneDays } from "./done-days";
export type { HabitTodayArea, HabitTodayItem } from "./today-summary";
export type { HabitWeekSummaryItem, HabitsWeekSummary } from "./week-summary";

/**
 * The summary's habits: active, started by today (Lima's day of `now`), with today's log, in their
 * manual order; then the pure rules keep the ones due today and not paused. Three queries (one
 * without habits). Trusts its caller (see getHabitsTodaySummary).
 */
export async function selectHabitsTodaySummary(db: Database, now: Date): Promise<HabitTodayItem[]> {
  return buildHabitsTodaySummary(await selectHabitsDueToday(db, now), now);
}

/**
 * The habits due today as full `HabitItem`s (what the pads and the logging hooks need), in the
 * manual order. Three queries (one without habits). Trusts its caller (see getHabitsDueToday).
 */
export async function selectHabitsDueToday(db: Database, now: Date): Promise<HabitItem[]> {
  const today = ownerDateKey(now);
  // A prefilter (the rules below check the start date again): no history read for habits that
  // haven't started.
  const started = and(activeHabit, lte(habits.startDate, today)) as SQL;
  return habitsDueToday(await selectItems(db, today, started), now);
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

/**
 * For `today`'s pads: the same habits as `getHabitsTodaySummary`, as the `HabitItem`s that
 * `HabitPad`, `useDayLog` and `useQuantityLog` take (inside `HabitsScreenWithin`). A board that
 * shows pads reads this one instead of the summary (one read, not two). Checks the owner.
 */
export async function getHabitsDueToday(now: Date): Promise<HabitItem[]> {
  await requireOwner();
  return selectHabitsDueToday(getDb(), now);
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
  const today = ownerDateKey(now);
  // A week still to come: nothing to read.
  if (monday > mondayOf(today)) return buildHabitsWeekSummary(monday, []);
  const week = await selectHabitsWeek(db, today, monday);
  // `selectHabitsWeek` clamps the week like "Semana"'s `?semana=` (to the first week of the
  // active habits): another week came back, so this one has no habits. Say nothing for it.
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

export type { TimedHabit } from "./today-summary";

/**
 * For `reminders` (R4, the `habit_time` reminder): the habits with a reminder time that are due on
 * the Lima day of `at`, started, active (neither archived nor deleted), not paused that day and
 * not met yet (`countsAsDone`: the day's quantity reached its target, or the week's quota is met
 * for "X veces por semana"), in the manual order. A habit to avoid never has a time. One query
 * when no habit has a time (the filter is in SQL), else the usual three. Trusts its caller (the
 * tick has no session).
 */
export async function selectTimedHabitsLeft(db: Database, at: Date): Promise<TimedHabit[]> {
  const today = ownerDateKey(at);
  const where = and(
    activeHabit,
    lte(habits.startDate, today),
    isNotNull(habits.reminderTime),
  ) as SQL;
  return timedHabitsLeft(await selectItems(db, today, where), at);
}

// ── Days done, for `goals` (SPEC-goals "Contratos") ──────────────────────────────────────────

/** A day range, both days included (Lima days, YYYY-MM-DD). */
export type DoneDaysRange = { from: string; to: string };

/** What a goal reads of its habit: the days done, the days expected and the habit's name. */
export type HabitDoneDaysReading = HabitDoneDays & { name: string };

/**
 * The days done of several habits, each over its own range (a goal's period): one answer per
 * request, in order, or null when the habit doesn't exist or is deleted (archived ones answer: a
 * goal keeps reading its history). Counted up to Lima's day of `now`. Always three queries (the
 * habits, their logs over the widest range, their pauses), whatever the number of requests.
 * Trusts its caller (see getHabitDoneDays).
 */
export async function selectHabitsDoneDays(
  db: Database | Tx,
  requests: readonly ({ habitId: string } & DoneDaysRange)[],
  now: Date,
): Promise<(HabitDoneDaysReading | null)[]> {
  if (requests.length === 0) return [];
  const today = ownerDateKey(now);
  const ids = [...new Set(requests.map((request) => request.habitId))];
  const rows = await db
    .select({
      id: habits.id,
      name: habits.name,
      kind: habits.kind,
      frequency: habits.frequency,
      weeklyTarget: habits.weeklyTarget,
      weekdays: habits.weekdays,
      startDate: habits.startDate,
    })
    .from(habits)
    .where(and(inArray(habits.id, ids), visibleHabit));
  const found = new Map(rows.map((row) => [row.id, row]));
  const wanted = requests.filter((request) => found.has(request.habitId));
  if (wanted.length === 0) return requests.map(() => null);
  const widest = {
    from: wanted.reduce((min, { from }) => (from < min ? from : min), wanted[0].from),
    to: wanted.reduce((max, { to }) => (to > max ? to : max), wanted[0].to),
  };
  const foundIds = [...found.keys()];
  // One after the other: a transaction shares one connection.
  const logs = await selectLogsInRange(db, foundIds, {
    from: widest.from,
    to: widest.to < today ? widest.to : today,
  });
  const pauses = await selectPauses(db, foundIds);
  return requests.map((request) => {
    const habit = found.get(request.habitId);
    if (!habit) return null;
    const history = {
      logs: new Map(
        (logs.get(habit.id) ?? []).map((log) => [
          log.day,
          { quantity: log.quantity, target: log.target },
        ]),
      ),
      pauses: pauses.get(habit.id) ?? [],
    };
    return { name: habit.name, ...doneDaysIn(habit, history, request, today) };
  });
}

/**
 * For `goals`: the days a habit was done between `from` and `to` (both included, Lima days) and
 * the days expected of it, with the streaks' rules: pauses and days the habit isn't scheduled are
 * out of the count; "X por semana" counts each logged day; today counts as it goes. Null when
 * the habit doesn't exist or is deleted. Checks the owner (redirects to /login without one).
 */
export async function getHabitDoneDays(
  habitId: string,
  from: string,
  to: string,
  now: Date = new Date(),
): Promise<HabitDoneDays | null> {
  await requireOwner();
  const [reading] = await selectHabitsDoneDays(getDb(), [{ habitId, from, to }], now);
  return reading ? { done: reading.done, expected: reading.expected } : null;
}

/** A habit a goal can follow. */
export type HabitOption = { id: string; name: string };

/**
 * The habits a goal can follow: active (neither archived nor deleted), in their manual order.
 * Trusts its caller (see getHabitOptions).
 */
export async function selectHabitOptions(db: Database | Tx): Promise<HabitOption[]> {
  return db
    .select({ id: habits.id, name: habits.name })
    .from(habits)
    .where(activeHabit)
    .orderBy(habits.sortOrder, habits.id);
}

/** For `goals`' form: the habits a goal can follow. Checks the owner. */
export async function getHabitOptions(): Promise<HabitOption[]> {
  await requireOwner();
  return selectHabitOptions(getDb());
}

/**
 * Whether each habit of `ids` can be followed by a goal: `"active"` (not archived, not deleted),
 * `"archived"` (visible, kept for a goal that already follows it) or missing from the map when it
 * doesn't exist or is deleted. One query. Trusts its caller.
 */
export async function selectHabitAvailability(
  db: Database | Tx,
  ids: readonly string[],
): Promise<Map<string, "active" | "archived">> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: habits.id, archivedAt: habits.archivedAt })
    .from(habits)
    .where(and(inArray(habits.id, [...ids]), visibleHabit));
  return new Map(rows.map((row) => [row.id, row.archivedAt === null ? "active" : "archived"]));
}
