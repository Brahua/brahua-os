import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// `habits` depends on `core` only (CAPABILITY-MAP): a habit may sit in a life area.
import { lifeAreas } from "@/modules/core/db/schema";
import {
  HABIT_CUE_MAX_LENGTH,
  HABIT_FREQUENCIES,
  HABIT_GOAL_MAX,
  HABIT_IDENTITY_MAX_LENGTH,
  HABIT_KINDS,
  HABIT_MEASURES,
  HABIT_NAME_MAX_LENGTH,
  HABIT_PAUSE_MAX_DAYS,
  HABIT_PAUSE_REASON_MAX_LENGTH,
  HABIT_QUANTITY_MAX,
  HABIT_UNIT_MAX_LENGTH,
  HABIT_WEEKDAYS_MAX,
  HABIT_WEEKLY_TARGET_MAX,
} from "../habit-constants";

export { HABIT_FREQUENCIES, HABIT_KINDS, HABIT_MEASURES } from "../habit-constants";

/** `'a', 'b', …` for an IN list. Only for these compile-time constants, never for user input. */
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", "));

/** A compile-time number inside a CHECK (never user input). */
const n = (value: number) => sql.raw(String(value));

// Defense in depth behind the Zod schemas (SPEC-habits "Modelo de datos"): raw SQL, scripts or a
// bug can't store an unknown kind, measure or frequency, an empty or too long text, a check habit
// with a goal, a quantity habit without a unit, an avoid habit that isn't a daily yes/no, or a
// frequency without exactly its own field. A NULL optional column passes (a CHECK only fails on
// false), so the rules that combine columns are wrapped in coalesce(…, false): a missing field
// would otherwise turn a branch into NULL and let the row through.

export const habits = pgTable(
  "habits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // 1–80, normalized like names
    identity: text("identity"), // ≤ 120, "Soy alguien que lee"
    cue: text("cue"), // ≤ 60, "Después del desayuno"
    kind: text("kind", { enum: HABIT_KINDS }).notNull().default("build"),
    // Optional; kept if the area is archived later. Colors the pad's LED.
    lifeAreaId: uuid("life_area_id").references(() => lifeAreas.id, { onDelete: "restrict" }),
    measure: text("measure", { enum: HABIT_MEASURES }).notNull(),
    goal: integer("goal").notNull().default(1), // 1 for check; 1–10 000 for quantity
    unit: text("unit"), // 1–20, quantity only
    step: integer("step").notNull().default(1), // 1–goal
    frequency: text("frequency", { enum: HABIT_FREQUENCIES }).notNull(),
    weeklyTarget: integer("weekly_target"), // 1–6, weekly_count only
    weekdays: integer("weekdays").array(), // ISO 1–7 strictly increasing, 1–6 items, weekdays only
    // A day in Lima (YYYY-MM-DD): no scheduled days and no logs before it.
    startDate: date("start_date").notNull(),
    // Manual order (Hoy); contiguous among the active ones under the order lock (habits.ts).
    sortOrder: integer("sort_order").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Soft delete: no physical deletes. Its logs and pauses hide with it (`visibleHabit`).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      // Stamped by the database clock on every Drizzle update. Raw SQL updates must set it themselves.
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    check(
      "habits_name_length_check",
      sql`char_length(${table.name}) between 1 and ${n(HABIT_NAME_MAX_LENGTH)}`,
    ),
    check(
      "habits_identity_length_check",
      sql`char_length(${table.identity}) between 1 and ${n(HABIT_IDENTITY_MAX_LENGTH)}`,
    ),
    check(
      "habits_cue_length_check",
      sql`char_length(${table.cue}) between 1 and ${n(HABIT_CUE_MAX_LENGTH)}`,
    ),
    check(
      "habits_unit_length_check",
      sql`char_length(${table.unit}) between 1 and ${n(HABIT_UNIT_MAX_LENGTH)}`,
    ),
    check("habits_kind_check", sql`${table.kind} in (${sqlList(HABIT_KINDS)})`),
    check("habits_measure_check", sql`${table.measure} in (${sqlList(HABIT_MEASURES)})`),
    check("habits_frequency_check", sql`${table.frequency} in (${sqlList(HABIT_FREQUENCIES)})`),
    // v1: a habit to avoid is a daily yes/no (a tap logs a relapse).
    check(
      "habits_avoid_check",
      sql`coalesce(${table.kind} <> 'avoid' or (${table.measure} = 'check' and ${table.frequency} = 'daily'), false)`,
    ),
    // check: goal 1, step 1, no unit. quantity: a unit, a goal of 1–10 000 and a step of 1–goal.
    check(
      "habits_measure_rule_check",
      sql`coalesce((
        ${table.measure} = 'check'
        and ${table.goal} = 1
        and ${table.step} = 1
        and ${table.unit} is null
      ) or (
        ${table.measure} = 'quantity'
        and ${table.unit} is not null
        and ${table.goal} between 1 and ${n(HABIT_GOAL_MAX)}
        and ${table.step} between 1 and ${table.goal}
      ), false)`,
    ),
    // Each frequency with exactly its own field: none for daily, X (1–6) for weekly_count, ISO
    // weekdays for weekdays (1–6 of them, 1–7, strictly ascending: never repeated, one
    // dimension, indexed from 1, no nulls).
    check(
      "habits_frequency_rule_check",
      sql`coalesce((
        ${table.frequency} = 'daily'
        and ${table.weeklyTarget} is null
        and ${table.weekdays} is null
      ) or (
        ${table.frequency} = 'weekly_count'
        and ${table.weeklyTarget} between 1 and ${n(HABIT_WEEKLY_TARGET_MAX)}
        and ${table.weekdays} is null
      ) or (
        ${table.frequency} = 'weekdays'
        and ${table.weeklyTarget} is null
        and array_ndims(${table.weekdays}) = 1
        and array_lower(${table.weekdays}, 1) = 1
        and cardinality(${table.weekdays}) between 1 and ${n(HABIT_WEEKDAYS_MAX)}
        and array_position(${table.weekdays}, null) is null
        and ${table.weekdays} <@ array[1, 2, 3, 4, 5, 6, 7]
        and (cardinality(${table.weekdays}) < 2 or ${table.weekdays}[1] < ${table.weekdays}[2])
        and (cardinality(${table.weekdays}) < 3 or ${table.weekdays}[2] < ${table.weekdays}[3])
        and (cardinality(${table.weekdays}) < 4 or ${table.weekdays}[3] < ${table.weekdays}[4])
        and (cardinality(${table.weekdays}) < 5 or ${table.weekdays}[4] < ${table.weekdays}[5])
        and (cardinality(${table.weekdays}) < 6 or ${table.weekdays}[5] < ${table.weekdays}[6])
      ), false)`,
    ),
    // "Hoy" and `today`: the active habits in their manual order.
    index("habits_sort_order_idx")
      .on(table.sortOrder)
      .where(sql`${table.deletedAt} is null and ${table.archivedAt} is null`),
  ],
);

/**
 * One row per habit and Lima day that was ever logged. Rows are never deleted: unmarking sets
 * `quantity` to 0. `target` is the goal in force that day (changing the goal later keeps the
 * past days' own, SPEC-habits "Meta en el historial").
 */
export const habitLogs = pgTable(
  "habit_logs",
  {
    habitId: uuid("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "restrict" }),
    day: date("day").notNull(), // a day in Lima, YYYY-MM-DD
    quantity: integer("quantity").notNull(), // 0–99 999 (0 = unmarked)
    target: integer("target").notNull(), // the goal in force that day
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    // Also what range reads ("this week", "this month") use.
    primaryKey({ columns: [table.habitId, table.day] }),
    check(
      "habit_logs_quantity_check",
      sql`${table.quantity} between 0 and ${n(HABIT_QUANTITY_MAX)}`,
    ),
    check("habit_logs_target_check", sql`${table.target} >= 1`),
  ],
);

/** A pause (trip, illness): its days neither break nor add to the streak (H4). */
export const habitPauses = pgTable(
  "habit_pauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    habitId: uuid("habit_id")
      .notNull()
      .references(() => habits.id, { onDelete: "restrict" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(), // inclusive, ≤ start + 89
    reason: text("reason"), // ≤ 60, "Viaje"
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Both ends included: at most 90 days.
    check(
      "habit_pauses_dates_check",
      sql`${table.endDate} >= ${table.startDate} and ${table.endDate} - ${table.startDate} < ${n(HABIT_PAUSE_MAX_DAYS)}`,
    ),
    check(
      "habit_pauses_reason_length_check",
      sql`char_length(${table.reason}) between 1 and ${n(HABIT_PAUSE_REASON_MAX_LENGTH)}`,
    ),
    // A habit's pauses by date (overlap check under the habit's lock, the pad's "En pausa").
    index("habit_pauses_habit_start_idx")
      .on(table.habitId, table.startDate)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export type Habit = typeof habits.$inferSelect;
export type NewHabit = typeof habits.$inferInsert;
export type HabitLog = typeof habitLogs.$inferSelect;
export type HabitPause = typeof habitPauses.$inferSelect;
