import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
// `goals` depends on `core` (life areas) and, as sources of progress, on `habits` and `projects`
// (CAPABILITY-MAP): a goal may point at one habit or one project through a foreign key.
import { lifeAreas } from "@/modules/core/db/schema";
import { habits } from "@/modules/habits/db/schema";
import { projects } from "@/modules/projects/db/schema";
import {
  GOAL_DELTA_MAX,
  GOAL_NOTES_MAX_LENGTH,
  GOAL_PERIOD_KINDS,
  GOAL_PROJECT_TARGET,
  GOAL_SOURCE_KINDS,
  GOAL_STATUSES,
  GOAL_TARGET_MAX,
  GOAL_TITLE_MAX_LENGTH,
  GOAL_UNIT_MAX_LENGTH,
  GOAL_YEAR_MAX,
  GOAL_YEAR_MIN,
  WEEKLY_OBJECTIVE_MAX_LENGTH,
} from "../goal-constants";

export { GOAL_PERIOD_KINDS, GOAL_SOURCE_KINDS, GOAL_STATUSES } from "../goal-constants";

/** `'a', 'b', …` for an IN list. Only for these compile-time constants, never for user input. */
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", "));

/** A compile-time number inside a CHECK (never user input). */
const n = (value: number) => sql.raw(String(value));

// Defense in depth behind the Zod schemas (SPEC-goals "Modelo de datos"): raw SQL, scripts or a
// bug can't store an unknown period, source or status, an empty or too long text, a quarter on a
// year goal (or none on a quarter one), or a source without exactly its own fields. A NULL
// optional column passes (a CHECK only fails on false), so the rules that combine columns are
// wrapped in coalesce(…, false): a missing field would otherwise turn a branch into NULL and let
// the row through (the same care as `habits`).

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(), // 1–80, normalized like names
    notes: text("notes"), // ≤ 2000
    periodKind: text("period_kind", { enum: GOAL_PERIOD_KINDS }).notNull(),
    year: integer("year").notNull(), // 2000–2100, in Lima
    quarter: integer("quarter"), // 1–4, only when periodKind = 'quarter'
    sourceKind: text("source_kind", { enum: GOAL_SOURCE_KINDS }).notNull(),
    habitId: uuid("habit_id").references(() => habits.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    target: integer("target").notNull(), // days (habit) · units (manual) · 100 (project)
    unit: text("unit"), // manual only, 1–20
    areaId: uuid("area_id").references(() => lifeAreas.id, { onDelete: "restrict" }),
    status: text("status", { enum: GOAL_STATUSES }).notNull().default("active"),
    achievedAt: timestamp("achieved_at", { withTimezone: true }),
    // Manual order; contiguous across every goal under the order lock (goals.ts). Archived and
    // deleted goals keep their slot.
    position: integer("position").notNull(),
    // Soft delete: no physical deletes. Its entries hide with it (`visibleGoal`).
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
      "goals_title_length_check",
      sql`char_length(${table.title}) between 1 and ${n(GOAL_TITLE_MAX_LENGTH)}`,
    ),
    check(
      "goals_notes_length_check",
      sql`char_length(${table.notes}) between 1 and ${n(GOAL_NOTES_MAX_LENGTH)}`,
    ),
    check(
      "goals_unit_length_check",
      sql`char_length(${table.unit}) between 1 and ${n(GOAL_UNIT_MAX_LENGTH)}`,
    ),
    check("goals_period_kind_check", sql`${table.periodKind} in (${sqlList(GOAL_PERIOD_KINDS)})`),
    check("goals_source_kind_check", sql`${table.sourceKind} in (${sqlList(GOAL_SOURCE_KINDS)})`),
    check("goals_status_check", sql`${table.status} in (${sqlList(GOAL_STATUSES)})`),
    check(
      "goals_year_check",
      sql`${table.year} between ${n(GOAL_YEAR_MIN)} and ${n(GOAL_YEAR_MAX)}`,
    ),
    // A quarter (1–4) if and only if the period is a quarter.
    check(
      "goals_quarter_rule_check",
      sql`coalesce((
        ${table.periodKind} = 'year' and ${table.quarter} is null
      ) or (
        ${table.periodKind} = 'quarter' and ${table.quarter} between 1 and 4
      ), false)`,
    ),
    // Each source with exactly its own fields: habit → habit_id and a number of days; project →
    // project_id and a target of 100; manual → a unit and a target, no habit or project.
    check(
      "goals_source_rule_check",
      sql`coalesce((
        ${table.sourceKind} = 'habit'
        and ${table.habitId} is not null
        and ${table.projectId} is null
        and ${table.unit} is null
        and ${table.target} between 1 and ${n(GOAL_TARGET_MAX)}
      ) or (
        ${table.sourceKind} = 'project'
        and ${table.projectId} is not null
        and ${table.habitId} is null
        and ${table.unit} is null
        and ${table.target} = ${n(GOAL_PROJECT_TARGET)}
      ) or (
        ${table.sourceKind} = 'manual'
        and ${table.unit} is not null
        and ${table.habitId} is null
        and ${table.projectId} is null
        and ${table.target} between 1 and ${n(GOAL_TARGET_MAX)}
      ), false)`,
    ),
    // The list: every visible goal in its manual order.
    index("goals_position_idx")
      .on(table.position)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * The entries of a manual goal: `+N` (also negative, to correct). Rows are never deleted: undoing
 * an entry sets `deleted_at`, and the sum reads the rest.
 */
export const goalEntries = pgTable(
  "goal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "restrict" }),
    delta: integer("delta").notNull(), // ≠ 0, |delta| ≤ 100 000
    entryDate: date("entry_date").notNull(), // the Lima day it was logged
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "goal_entries_delta_check",
      sql`${table.delta} <> 0 and abs(${table.delta}) <= ${n(GOAL_DELTA_MAX)}`,
    ),
    // A goal's entries, newest first (the sum and the history).
    index("goal_entries_goal_idx")
      .on(table.goalId, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/** G3: the text of a week (Monday–Sunday, Lima), keyed by its Monday. G1 only creates the table. */
export const weeklyObjectives = pgTable(
  "weekly_objectives",
  {
    weekStart: date("week_start").primaryKey(), // a Monday in Lima
    text: text("text").notNull(), // 1–140
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    check(
      "weekly_objectives_text_length_check",
      sql`char_length(${table.text}) between 1 and ${n(WEEKLY_OBJECTIVE_MAX_LENGTH)}`,
    ),
    // ISO day of the week 1 = Monday.
    check("weekly_objectives_monday_check", sql`extract(isodow from ${table.weekStart}) = 1`),
  ],
);

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type GoalEntry = typeof goalEntries.$inferSelect;
export type WeeklyObjective = typeof weeklyObjectives.$inferSelect;
