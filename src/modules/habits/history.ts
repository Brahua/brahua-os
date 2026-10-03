// H5's reads (server only): the "Semana" view and a habit's page. Like habits.ts, these take the
// database and trust their input (the queries in queries.ts check the owner first). Both read a
// fixed number of queries, whatever the number of habits or days (no query per habit or day):
// - "Semana": the active habits, every log of the week (`selectLogsInRange`) and their pauses;
// - a habit's page: `selectItemsWithHistory` (the habit with today's log, the logs the streak
//   rules need plus every log of the calendar's month, and its pauses).
// Both filter with `activeHabit`/`visibleHabit` and `ofVisibleHabit` like every read of habits.
import "server-only";
import { and, eq, gte, inArray, isNotNull, lte, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { monthEnd } from "./calendar";
import { habitLogs, habits } from "./db/schema";
import type { DeletedHabit } from "./habit-input";
import {
  activeHabit,
  groupBy,
  selectItemsWithHistory,
  selectPauses,
  visibleHabit,
  type DayRange,
  type LoadedHabit,
  type Tx,
} from "./habits";
import { addDays } from "./schedule";
import type { Compliance, DayLog, StreakHistory } from "./streak";
import { habitWeekRow, parseWeekParam, weekTotal, type HabitWeekRow } from "./week-summary";

/**
 * Every log of the habits within `range` (both days included), by habit (one query): the week
 * view's days and their partial quantities. Only logs of visible habits, from their start date.
 */
export async function selectLogsInRange(db: Database | Tx, ids: string[], range: DayRange) {
  const rows = await db
    .select({
      habitId: habitLogs.habitId,
      day: habitLogs.day,
      quantity: habitLogs.quantity,
      target: habitLogs.target,
    })
    .from(habitLogs)
    .innerJoin(habits, eq(habits.id, habitLogs.habitId))
    .where(
      and(
        inArray(habitLogs.habitId, ids),
        visibleHabit,
        gte(habitLogs.day, habits.startDate),
        gte(habitLogs.day, range.from),
        lte(habitLogs.day, range.to),
      ),
    )
    .orderBy(habitLogs.habitId, habitLogs.day);
  return groupBy(rows, (row) => row.habitId);
}

/** The "Semana" view: the week shown, its rows and its total. */
export type HabitsWeek = {
  /** The Monday of the week shown. */
  monday: string;
  /** The earliest start date of the active habits (the first week there is), or null. */
  earliestStart: string | null;
  /** The active habits that had started by that Sunday, in their manual order. */
  rows: HabitWeekRow[];
  /** "18 de 24": the rows' compliance summed. */
  total: Compliance;
};

/**
 * The week of `requested` (`?semana=`, any day of it; kept between the first week of the active
 * habits and the current one) for the active habits that had started by its Sunday: each one's 7
 * days and compliance (`habitWeekRow`), and the total. Three queries (one without habits).
 */
export async function selectHabitsWeek(
  db: Database,
  today: string,
  requested?: string | string[],
): Promise<HabitsWeek> {
  const habitRows = await db
    .select({
      id: habits.id,
      name: habits.name,
      kind: habits.kind,
      measure: habits.measure,
      goal: habits.goal,
      unit: habits.unit,
      frequency: habits.frequency,
      weeklyTarget: habits.weeklyTarget,
      weekdays: habits.weekdays,
      startDate: habits.startDate,
      area: {
        id: lifeAreas.id,
        slug: lifeAreas.slug,
        name: lifeAreas.name,
        icon: lifeAreas.icon,
        color: lifeAreas.color,
      },
    })
    .from(habits)
    .leftJoin(lifeAreas, eq(lifeAreas.id, habits.lifeAreaId))
    .where(activeHabit)
    .orderBy(habits.sortOrder, habits.id);
  const earliestStart = habitRows.reduce<string | null>(
    (earliest, row) => (earliest === null || row.startDate < earliest ? row.startDate : earliest),
    null,
  );
  const monday = parseWeekParam(requested, today, earliestStart);
  const sunday = addDays(monday, 6);
  const started = habitRows.filter((row) => row.startDate <= sunday);
  if (started.length === 0) {
    return { monday, earliestStart, rows: [], total: { done: 0, expected: 0 } };
  }
  const ids = started.map((row) => row.id);
  // One after the other, like selectItems (a transaction shares one connection).
  const logs = await selectLogsInRange(db, ids, {
    from: monday,
    to: sunday < today ? sunday : today,
  });
  const pauses = await selectPauses(db, ids);
  const rows = started.map((habit) => {
    const history: StreakHistory = {
      logs: new Map<string, DayLog>(
        (logs.get(habit.id) ?? []).map((log) => [
          log.day,
          { quantity: log.quantity, target: log.target },
        ]),
      ),
      pauses: pauses.get(habit.id) ?? [],
    };
    return habitWeekRow(habit, history, monday, today);
  });
  return { monday, earliestStart, rows, total: weekTotal(rows) };
}

/**
 * A visible habit (archived ones too) for its page: the `HabitItem` with today's log, every log
 * the stats need (the marked days since its start, the last 7 days) plus every log of `month`
 * (the calendar, with partial quantities), and all its pauses (past ones too). Three queries.
 * Null when it doesn't exist or is deleted.
 */
export async function selectHabitDetail(
  db: Database,
  id: string,
  month: string,
  today: string,
): Promise<LoadedHabit | null> {
  const last = monthEnd(month);
  const range = { from: `${month}-01`, to: last < today ? last : today };
  const where: SQL = and(eq(habits.id, id), visibleHabit) as SQL;
  const [loaded] = await selectItemsWithHistory(db, today, where, today, range);
  return loaded ?? null;
}

/**
 * A habit that is deleted (the list's "Hábito eliminado · Deshacer" after deleting it from its
 * page), or null when it doesn't exist or isn't deleted (e.g. already restored).
 */
export async function selectDeletedHabit(db: Database, id: string): Promise<DeletedHabit | null> {
  const [row] = await db
    .select({ id: habits.id, name: habits.name })
    .from(habits)
    .where(and(eq(habits.id, id), isNotNull(habits.deletedAt)));
  return row ?? null;
}
