import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// `health` depends on `core` and, by contract, on `habits` (SPEC-health "Contratos"): the settings
// may name a habit through a foreign key, the one import of another module's table
// (eslint.config.mjs).
import { habits } from "@/modules/habits/db/schema";
import {
  DEFAULT_REST_SECONDS,
  DISTANCE_MAX_METERS,
  EQUIPMENT,
  EXERCISE_KINDS,
  EXERCISE_NAME_MAX_LENGTH,
  MUSCLE_GROUPS,
  REST_MAX_SECONDS,
  REST_MIN_SECONDS,
  ROUTINE_NAME_MAX_LENGTH,
  SESSION_NOTE_MAX_LENGTH,
  SET_REPS_MAX,
  SET_REPS_MIN,
  SET_SECONDS_MAX,
  SET_SECONDS_MIN,
  TARGET_REPS_MAX,
  TARGET_REPS_MIN,
  TARGET_SECONDS_MAX,
  TARGET_SECONDS_MIN,
  TARGET_SETS_MAX,
  TARGET_SETS_MIN,
  WEIGHT_MAX_GRAMS,
  WEIGHT_STEP_GRAMS,
} from "../health-constants";

/** A compile-time number inside a CHECK (never user input). */
const n = (value: number) => sql.raw(String(value));
/** A compile-time list of words inside a CHECK (never user input). */
const words = (values: readonly string[]) => sql.raw(values.map((word) => `'${word}'`).join(", "));

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    // Stamped by the database clock on every Drizzle update. Raw SQL updates must set it themselves.
    .$onUpdate(() => sql`now()`),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

// Defense in depth behind the Zod schemas (SPEC-health "Modelo de datos"): raw SQL, scripts or a
// bug can't store an unknown kind, group or equipment, an empty or too long name, or a target or a
// rest out of range. Which targets a routine item needs by its exercise's kind (reps for
// weight_reps/reps, seconds for time/cardio) lives in Zod and the data layer: a CHECK can't read
// another table.

/**
 * E1: the exercise catalogue: the 64 of the seed (`seed_key`, inserted by migration 0029) and the
 * owner's own. Soft delete (`deleted_at`, with «Deshacer»). `name_key` is the name lowercased and
 * without accents, computed by the app (name-key.ts): the search and the uniqueness among live
 * exercises use it.
 */
export const healthExercises = pgTable(
  "health_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seedKey: text("seed_key"), // only the seed's; unique when present
    name: text("name").notNull(), // 1–80, normalized like names
    nameKey: text("name_key").notNull(),
    kind: text("kind", { enum: EXERCISE_KINDS }).notNull(),
    muscleGroup: text("muscle_group", { enum: MUSCLE_GROUPS }).notNull(),
    equipment: text("equipment", { enum: EQUIPMENT }).notNull(),
    perDumbbell: boolean("per_dumbbell").notNull().default(false),
    restSeconds: integer("rest_seconds").notNull().default(DEFAULT_REST_SECONDS), // 30–600
    ...timestamps,
  },
  (table) => [
    check(
      "health_exercises_name_check",
      sql`char_length(${table.name}) between 1 and ${n(EXERCISE_NAME_MAX_LENGTH)}`,
    ),
    check("health_exercises_name_key_check", sql`char_length(${table.nameKey}) >= 1`),
    check("health_exercises_kind_check", sql`${table.kind} in (${words(EXERCISE_KINDS)})`),
    check(
      "health_exercises_muscle_group_check",
      sql`${table.muscleGroup} in (${words(MUSCLE_GROUPS)})`,
    ),
    check("health_exercises_equipment_check", sql`${table.equipment} in (${words(EQUIPMENT)})`),
    check(
      "health_exercises_rest_check",
      sql`${table.restSeconds} between ${n(REST_MIN_SECONDS)} and ${n(REST_MAX_SECONDS)}`,
    ),
    // Two live exercises never share a name (without case or accents); a deleted one doesn't block.
    uniqueIndex("health_exercises_name_key_unique")
      .on(table.nameKey)
      .where(sql`${table.deletedAt} is null`),
    // The seed's stable key, deleted rows included: inserting the seed again adds nothing.
    uniqueIndex("health_exercises_seed_key_unique")
      .on(table.seedKey)
      .where(sql`${table.seedKey} is not null`),
  ],
);

/**
 * E1: the routines (templates): a name and the manual order of the list. Soft delete; `position`
 * is contiguous (0…n-1) among the live ones, under the routines lock (routines.ts).
 */
export const healthRoutines = pgTable(
  "health_routines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // 1–60
    position: integer("position").notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      "health_routines_name_check",
      sql`char_length(${table.name}) between 1 and ${n(ROUTINE_NAME_MAX_LENGTH)}`,
    ),
    check("health_routines_position_check", sql`${table.position} >= 0`),
    index("health_routines_position_idx")
      .on(table.position)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * E1: a routine's exercises in order, each with its targets: sets, and either reps min–max or
 * seconds; an own rest is optional (else the exercise's). An exercise may repeat in a routine.
 * Soft delete; `position` contiguous among a routine's live items, under the routine's lock.
 */
export const healthRoutineExercises = pgTable(
  "health_routine_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => healthRoutines.id, { onDelete: "restrict" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => healthExercises.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    targetSets: integer("target_sets").notNull(), // 1–10
    repsMin: integer("reps_min"), // 1–100, with reps_max (weight_reps, reps)
    repsMax: integer("reps_max"),
    targetSeconds: integer("target_seconds"), // 1–36 000 (time, cardio)
    restSeconds: integer("rest_seconds"), // 30–600, optional
    ...timestamps,
  },
  (table) => [
    check(
      "health_routine_exercises_sets_check",
      sql`${table.targetSets} between ${n(TARGET_SETS_MIN)} and ${n(TARGET_SETS_MAX)}`,
    ),
    // Reps come as a pair, within 1–100 and min ≤ max (equal: one number).
    check(
      "health_routine_exercises_reps_check",
      sql`(${table.repsMin} is null) = (${table.repsMax} is null) and (${table.repsMin} is null or (${table.repsMin} between ${n(TARGET_REPS_MIN)} and ${n(TARGET_REPS_MAX)} and ${table.repsMax} between ${n(TARGET_REPS_MIN)} and ${n(TARGET_REPS_MAX)} and ${table.repsMin} <= ${table.repsMax}))`,
    ),
    check(
      "health_routine_exercises_seconds_check",
      sql`${table.targetSeconds} is null or ${table.targetSeconds} between ${n(TARGET_SECONDS_MIN)} and ${n(TARGET_SECONDS_MAX)}`,
    ),
    // Reps or seconds, never both.
    check(
      "health_routine_exercises_target_check",
      sql`${table.repsMin} is null or ${table.targetSeconds} is null`,
    ),
    check(
      "health_routine_exercises_rest_check",
      sql`${table.restSeconds} is null or ${table.restSeconds} between ${n(REST_MIN_SECONDS)} and ${n(REST_MAX_SECONDS)}`,
    ),
    check("health_routine_exercises_position_check", sql`${table.position} >= 0`),
    index("health_routine_exercises_routine_idx")
      .on(table.routineId, table.position)
      .where(sql`${table.deletedAt} is null`),
    // Is this exercise in a live routine? (deleting it or changing its kind asks).
    index("health_routine_exercises_exercise_idx")
      .on(table.exerciseId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * E1 (filled in E4): the module's settings, one row (`id = 1`): the habit a finished session marks
 * (or none). No soft delete: it is a setting, not a record.
 */
export const healthSettings = pgTable(
  "health_settings",
  {
    id: integer("id").primaryKey(),
    habitId: uuid("habit_id").references(() => habits.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [check("health_settings_single_row_check", sql`${table.id} = 1`)],
);

/**
 * E2: a training session, started from a routine (`routine_id`) or free (null). `ended_at` null =
 * open; at most one open live session (the partial unique index, behind the session lock in
 * sessions.ts). `habit_marked_day` is E4's: the Lima day this session marked the linked habit.
 * Soft delete (discard, or delete a finished one), with «Deshacer». `updated_at` is stamped to the
 * millisecond by every session write (sessions.ts): the «Deshacer» of «Terminar» compares it.
 */
export const healthSessions = pgTable(
  "health_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routineId: uuid("routine_id").references(() => healthRoutines.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    note: text("note"), // ≤ 500
    habitMarkedDay: date("habit_marked_day"),
    ...timestamps,
  },
  (table) => [
    check(
      "health_sessions_note_check",
      sql`${table.note} is null or char_length(${table.note}) <= ${n(SESSION_NOTE_MAX_LENGTH)}`,
    ),
    check(
      "health_sessions_ended_check",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
    // One open session at a time (SPEC-health "Empezar").
    uniqueIndex("health_sessions_open_unique")
      .on(sql`(true)`)
      .where(sql`${table.endedAt} is null and ${table.deletedAt} is null`),
    // The lists by time, and the rotation (the last finished session of each routine).
    index("health_sessions_started_idx")
      .on(table.startedAt)
      .where(sql`${table.deletedAt} is null`),
    index("health_sessions_routine_idx")
      .on(table.routineId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * E2: a session's exercises in order. `rest_seconds` is copied from the routine's item when the
 * session starts (null: the exercise's). What changes here never touches the routine.
 */
export const healthSessionExercises = pgTable(
  "health_session_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => healthSessions.id, { onDelete: "restrict" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => healthExercises.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    restSeconds: integer("rest_seconds"), // 30–600, optional
    ...timestamps,
  },
  (table) => [
    check(
      "health_session_exercises_rest_check",
      sql`${table.restSeconds} is null or ${table.restSeconds} between ${n(REST_MIN_SECONDS)} and ${n(REST_MAX_SECONDS)}`,
    ),
    check("health_session_exercises_position_check", sql`${table.position} >= 0`),
    index("health_session_exercises_session_idx")
      .on(table.sessionId, table.position)
      .where(sql`${table.deletedAt} is null`),
    // An exercise's history (the prefill, E3's records).
    index("health_session_exercises_exercise_idx")
      .on(table.exerciseId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * E2: a set of a session's exercise. Which values a done set needs by its exercise's kind lives in
 * Zod and sessions.ts (a CHECK can't read another table); the ranges are here. `done_at` null = a
 * planned set; «Terminar» soft-deletes the planned ones (its «Deshacer» brings them back).
 */
export const healthSets = pgTable(
  "health_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionExerciseId: uuid("session_exercise_id")
      .notNull()
      .references(() => healthSessionExercises.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    weightGrams: integer("weight_grams"), // 0–1 000 000, multiple of 250
    reps: integer("reps"), // 1–999
    seconds: integer("seconds"), // 1–36 000
    distanceMeters: integer("distance_meters"), // 0–1 000 000
    warmup: boolean("warmup").notNull().default(false),
    doneAt: timestamp("done_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      "health_sets_weight_check",
      sql`${table.weightGrams} is null or (${table.weightGrams} between 0 and ${n(WEIGHT_MAX_GRAMS)} and ${table.weightGrams} % ${n(WEIGHT_STEP_GRAMS)} = 0)`,
    ),
    check(
      "health_sets_reps_check",
      sql`${table.reps} is null or ${table.reps} between ${n(SET_REPS_MIN)} and ${n(SET_REPS_MAX)}`,
    ),
    check(
      "health_sets_seconds_check",
      sql`${table.seconds} is null or ${table.seconds} between ${n(SET_SECONDS_MIN)} and ${n(SET_SECONDS_MAX)}`,
    ),
    check(
      "health_sets_distance_check",
      sql`${table.distanceMeters} is null or ${table.distanceMeters} between 0 and ${n(DISTANCE_MAX_METERS)}`,
    ),
    check("health_sets_position_check", sql`${table.position} >= 0`),
    index("health_sets_exercise_idx")
      .on(table.sessionExerciseId, table.position)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export type HealthExercise = typeof healthExercises.$inferSelect;
export type NewHealthExercise = typeof healthExercises.$inferInsert;
export type HealthRoutine = typeof healthRoutines.$inferSelect;
export type HealthRoutineExercise = typeof healthRoutineExercises.$inferSelect;
export type HealthSettings = typeof healthSettings.$inferSelect;
export type HealthSession = typeof healthSessions.$inferSelect;
export type HealthSessionExercise = typeof healthSessionExercises.$inferSelect;
export type HealthSet = typeof healthSets.$inferSelect;
