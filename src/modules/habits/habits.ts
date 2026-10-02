// Habits data access (server only). These functions take the database and trust their input:
// callers check the owner and validate first (the actions through ownerAction(), the queries
// with requireOwner()).
//
// Locks (CLAUDE.md "Advisory locks"; SPEC-habits "Bloqueos"), all in `HABITS_ADVISORY_SPACE`:
// - `(4000, hashtext('habits:order'))` (`lockHabitsOrder`): anything that changes which habits
//   are active or their order: create, reorder (H2), archive and unarchive (H2), delete and
//   restore. Keeps `sort_order` consistent, like `LIFE_AREAS_LOCK`.
// - `(4000, hashtext(<habit id>))` (`lockHabit`): one habit's pauses (no overlaps, H4), goal
//   changes with the `target` of today on (H3, quantity.ts), delete and restore.
// Rule: advisory locks are always the first locks of the transaction, never taken after a row
// lock; with both, the order lock first, then the habit's. Only then the rows: the habit FOR
// UPDATE (or FOR SHARE to log a day), the area FOR SHARE.
//
// Logging a day takes no advisory lock: it is one atomic upsert on (habit_id, day) after reading
// the habit FOR SHARE (a delete, an archive or a goal change at the same time waits, or makes it
// wait). That holds for a quantity's delta and exact amount too (quantity.ts).
import "server-only";
import { and, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { habitLogs, habitPauses, habits } from "./db/schema";
import { frequencyColumns } from "./frequency-input";
import { measureColumns } from "./measure-input";
import type {
  CreateHabitInput,
  DeletedHabit,
  HabitDayLog,
  HabitItem,
  HabitPauseSummary,
  SetHabitDoneInput,
} from "./habit-input";
import { addDays, isLoggableDay, logWindowStart, weekStart } from "./schedule";
import {
  availableDaysInWeek,
  isAvailableOn,
  isDoneOn,
  streakChoice,
  type StreakHistory,
  type StreakRules,
} from "./streak";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** First key of every advisory lock `habits` takes (its namespace among the app's locks). */
export const HABITS_ADVISORY_SPACE = 4_000;

/** Second key of the order lock (create, reorder, archive, unarchive, delete, restore). */
export const HABITS_ORDER_KEY = "habits:order";

async function advisoryLock(tx: Tx, key: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(HABITS_ADVISORY_SPACE))}, hashtext(${key}))`,
  );
}

/** The order lock. Must be the first lock of the transaction (see the header). */
export function lockHabitsOrder(tx: Tx) {
  return advisoryLock(tx, HABITS_ORDER_KEY);
}

/** One habit's lock. First locks only (after the order lock, when both are taken). */
export function lockHabit(tx: Tx, id: string) {
  return advisoryLock(tx, id);
}

/**
 * Whether a habit is visible (SPEC-habits "Visibilidad"): not deleted. EVERY read and write of
 * habits (H2–H6 included: lists, the week, the calendar, `today`, the streaks) must filter with
 * it; logs and pauses through `ofVisibleHabit`.
 */
export const visibleHabit = isNull(habits.deletedAt);

/** Visible and not archived: what "Hoy", "Semana" and `today` show. */
export const activeHabit = and(visibleHabit, isNull(habits.archivedAt)) as SQL;

/**
 * For reads of `habit_logs` and `habit_pauses`: the row's habit is visible (a deleted habit's
 * logs and pauses hide with it and come back when it is restored). A subquery, so it fits any
 * query without a join.
 */
export function ofVisibleHabit(habitId: AnyPgColumn): SQL {
  return sql`exists (
    select 1 from habits visible_habit
    where visible_habit.id = ${habitId} and visible_habit.deleted_at is null
  )`;
}

const dayLog = alias(habitLogs, "day_log");

const ROW = {
  id: habits.id,
  name: habits.name,
  kind: habits.kind,
  measure: habits.measure,
  goal: habits.goal,
  unit: habits.unit,
  step: habits.step,
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
  quantity: sql<number>`coalesce(${dayLog.quantity}, 0)`.mapWith(Number),
  target: sql<number>`coalesce(${dayLog.target}, ${habits.goal})`.mapWith(Number),
  // Any log row, unmarked ones (0) included: once a day was logged, deleting asks first. The
  // optimistic view says the same after a tap (`donePatch`), so both agree.
  hasLogs: sql<boolean>`exists (
    select 1 from habit_logs any_log where any_log.habit_id = ${habits.id}
  )`.mapWith(Boolean),
};

/**
 * Habits as `HabitItem`s for `day` (that day's log), in their manual order, with what H4 adds:
 * the streak (counted up to `today`, Lima's), the week's available days, the current or next
 * pause and the last 7 days' logs. Callers filter with `visibleHabit` or `activeHabit`.
 *
 * Always three queries, whatever the number of habits (no query per habit): the habits with the
 * day's log, the logs the rules need (`selectStreakLogs`) and their pauses (`selectPauses`). The
 * streaks are computed here with the pure rules of streak.ts.
 */
export async function selectItems(
  db: Database | Tx,
  day: string,
  where: SQL | undefined,
  today: string = day,
): Promise<HabitItem[]> {
  const rows = await db
    .select(ROW)
    .from(habits)
    .leftJoin(lifeAreas, eq(lifeAreas.id, habits.lifeAreaId))
    .leftJoin(dayLog, and(eq(dayLog.habitId, habits.id), eq(dayLog.day, day)))
    .where(where)
    .orderBy(habits.sortOrder, habits.id);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  // One after the other: inside a transaction the queries share its single connection.
  const logs = await selectStreakLogs(db, ids, today);
  const pauses = await selectPauses(db, ids);
  return rows.map((row) => {
    const history = {
      logs: new Map(
        (logs.get(row.id) ?? []).map((log) => [
          log.day,
          { quantity: log.quantity, target: log.target },
        ]),
      ),
      pauses: pauses.get(row.id) ?? [],
    };
    return { ...row, ...historyFields(row, history, day, today) };
  });
}

/**
 * The logs the streak rules need, by habit, oldest first (one query): from each habit's start
 * date to `today`, the marked days (done for a habit to keep: `quantity >= target`, its own
 * target; a relapse for a habit to avoid) and every log of the last 7 days ("Registrar otro
 * día" shows partial quantities too). Unmarked older rows can't change a streak.
 */
async function selectStreakLogs(db: Database | Tx, ids: string[], today: string) {
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
        sql`${habitLogs.day} >= ${habits.startDate}`,
        lte(habitLogs.day, today),
        or(
          gte(habitLogs.day, logWindowStart(today)),
          sql`(${habits.kind} = 'build' and ${habitLogs.quantity} >= ${habitLogs.target})`,
          sql`(${habits.kind} = 'avoid' and ${habitLogs.quantity} > 0)`,
        ),
      ),
    )
    .orderBy(habitLogs.habitId, habitLogs.day);
  return groupBy(rows, (row) => row.habitId);
}

/** The pauses of the habits (not deleted), by habit, by start date (one query). */
async function selectPauses(db: Database | Tx, ids: string[]) {
  const rows = await db
    .select({
      habitId: habitPauses.habitId,
      id: habitPauses.id,
      startDate: habitPauses.startDate,
      endDate: habitPauses.endDate,
      reason: habitPauses.reason,
    })
    .from(habitPauses)
    .where(
      and(
        inArray(habitPauses.habitId, ids),
        isNull(habitPauses.deletedAt),
        ofVisibleHabit(habitPauses.habitId),
      ),
    )
    .orderBy(habitPauses.habitId, habitPauses.startDate);
  return groupBy(rows, (row) => row.habitId);
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const list = groups.get(key(row));
    if (list) list.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

/** What H2–H4 derive from a habit's history for `day` (the day read) and `today`. */
function historyFields(
  habit: StreakRules,
  history: { logs: StreakHistory["logs"]; pauses: readonly HabitPauseSummary[] },
  day: string,
  today: string,
) {
  const monday = weekStart(day);
  // H2: done days of the week before the day read (paused ones don't count, H4). A habit to
  // avoid has no week.
  let weekDoneBefore = 0;
  if (habit.kind === "build") {
    for (let other = monday; other < day; other = addDays(other, 1)) {
      if (isAvailableOn(habit, history.pauses, other) && isDoneOn(habit, history, other)) {
        weekDoneBefore += 1;
      }
    }
  }
  const windowStart = logWindowStart(today);
  const recentLogs: HabitDayLog[] = [];
  for (const [logDay, log] of history.logs) {
    if (logDay >= windowStart && logDay < today) recentLogs.push({ day: logDay, ...log });
  }
  const pause =
    history.pauses.find((range) => range.startDate <= today && today <= range.endDate) ??
    history.pauses.find((range) => range.startDate > today) ??
    null;
  return {
    weekDoneBefore,
    weekAvailable: availableDaysInWeek(habit, history.pauses, monday),
    streak: streakChoice(habit, history, today),
    pause: pause
      ? { id: pause.id, startDate: pause.startDate, endDate: pause.endDate, reason: pause.reason }
      : null,
    recentLogs,
  };
}

/** The active habits (neither archived nor deleted) with `today`'s log, in their manual order. */
export async function selectActiveHabits(db: Database, today: string): Promise<HabitItem[]> {
  return selectItems(db, today, activeHabit);
}

/** One visible habit with `day`'s log (its streak up to `today`), or null. */
export async function selectHabitItemById(
  db: Database | Tx,
  id: string,
  day: string,
  today: string = day,
): Promise<HabitItem | null> {
  const [item] = await selectItems(db, day, and(eq(habits.id, id), visibleHabit), today);
  return item ?? null;
}

/** Why a write was refused. */
export type HabitFailure =
  | "notFound"
  | "archived"
  | "areaUnavailable"
  | "dayOutOfWindow"
  | "measureMismatch"
  /** H3: a quantity write (a tap's delta, an exact amount, a goal) on a yes/no habit. */
  | "notQuantity"
  /** H3: an edit that makes a habit to avoid other than daily. */
  | "avoidDaily"
  /** H4: a pause that overlaps another of the habit (checked under the habit's lock). */
  | "pauseOverlap"
  /** H4: a pause starting more than 7 days back or more than a year ahead. */
  | "pauseStartOutOfWindow"
  /** H4: a pause that doesn't exist (or was removed) for that habit. */
  | "pauseNotFound";

/**
 * Creates a habit at the end of the manual order, starting `today`. H1: a daily yes/no habit to
 * keep. An area must be active (read FOR SHARE: an archive at the same time waits, so a habit
 * never lands in an area archived after the check). Returns the habit, or why it was refused.
 */
export async function insertHabit(
  db: Database,
  input: CreateHabitInput,
  today: string,
): Promise<HabitItem | HabitFailure> {
  return db.transaction(async (tx) => {
    await lockHabitsOrder(tx);
    if (input.lifeAreaId !== null) {
      const [area] = await tx
        .select({ id: lifeAreas.id })
        .from(lifeAreas)
        .where(and(eq(lifeAreas.id, input.lifeAreaId), isNull(lifeAreas.archivedAt)))
        .for("share");
      if (!area) return "areaUnavailable";
    }
    // Last of all (deleted and archived ones included, so a restored habit gets its old place
    // back and two habits never share one). Safe under the order lock.
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${habits.sortOrder}) + 1, 0)`.mapWith(Number) })
      .from(habits);
    const [created] = await tx
      .insert(habits)
      .values({
        name: input.name,
        lifeAreaId: input.lifeAreaId,
        // H2 (frequency-input.ts) and H3 (measure-input.ts) own these.
        ...frequencyColumns(input),
        ...measureColumns(input),
        startDate: today,
        sortOrder: next,
      })
      .returning({ id: habits.id });
    return (await selectHabitItemById(tx, created.id, today)) as HabitItem;
  });
}

/**
 * Marks or unmarks a yes/no habit's day, as the state wanted (idempotent: twice changes nothing).
 * One atomic upsert on (habit_id, day); unmarking keeps the row with quantity 0 (rows are never
 * deleted). The habit is read FOR SHARE: neither archived nor deleted, and the day within the
 * window (today and the 7 before, from its start date). Returns that day's habit, or why not.
 */
export async function setHabitDoneById(
  db: Database,
  input: SetHabitDoneInput,
  today: string,
): Promise<HabitItem | HabitFailure> {
  return db.transaction(async (tx) => {
    const [habit] = await tx
      .select({
        measure: habits.measure,
        goal: habits.goal,
        startDate: habits.startDate,
        archivedAt: habits.archivedAt,
      })
      .from(habits)
      .where(and(eq(habits.id, input.id), visibleHabit))
      .for("share");
    if (!habit) return "notFound";
    if (habit.archivedAt !== null) return "archived";
    // Quantity habits log through `logHabit` (a delta) or `setHabitQuantity` (quantity.ts).
    if (habit.measure !== "check") return "measureMismatch";
    if (!isLoggableDay(input.day, today, habit.startDate)) return "dayOutOfWindow";
    const quantity = input.done ? 1 : 0;
    await tx
      .insert(habitLogs)
      .values({ habitId: input.id, day: input.day, quantity, target: habit.goal })
      .onConflictDoUpdate({
        target: [habitLogs.habitId, habitLogs.day],
        set: { quantity, updatedAt: sql`now()` },
      });
    return (await selectHabitItemById(tx, input.id, input.day, today)) as HabitItem;
  });
}

/**
 * Soft delete: stamps `deleted_at`, so the habit (with its logs and pauses) leaves every view but
 * stays in `pnpm db:export`. Null when it doesn't exist or is already deleted.
 */
export async function softDeleteHabit(db: Database, id: string): Promise<DeletedHabit | null> {
  return db.transaction(async (tx) => {
    await lockHabitsOrder(tx);
    await lockHabit(tx, id);
    const [deleted] = await tx
      .update(habits)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(habits.id, id), visibleHabit))
      .returning({ id: habits.id, name: habits.name });
    return deleted ?? null;
  });
}

/**
 * Undoes a soft delete, back in its place in the order. Restoring one that isn't deleted changes
 * nothing (a second "Deshacer" is not an error). Null only when the habit doesn't exist at all.
 */
export async function restoreHabitById(
  db: Database,
  id: string,
  today: string,
): Promise<HabitItem | null> {
  return db.transaction(async (tx) => {
    await lockHabitsOrder(tx);
    await lockHabit(tx, id);
    await tx
      .update(habits)
      .set({ deletedAt: null })
      .where(and(eq(habits.id, id), isNotNull(habits.deletedAt)));
    return selectHabitItemById(tx, id, today);
  });
}
