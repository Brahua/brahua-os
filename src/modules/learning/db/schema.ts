import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
// `learning` depends on `core` and `projects` (SPEC-learning): a track may belong to a project
// through a foreign key, the one import of another module's table (eslint.config.mjs).
import { projects } from "@/modules/projects/db/schema";
import {
  STEP_TITLE_MAX_LENGTH,
  TARGET_DATE_MAX,
  TARGET_DATE_MIN,
  TRACK_KINDS,
  TRACK_STATUSES,
  TRACK_TITLE_MAX_LENGTH,
  TRACK_URL_MAX_LENGTH,
  WEEKLY_TARGET_MAX_MINUTES,
  WEEKLY_TARGET_MIN_MINUTES,
} from "../learning-constants";

/** A compile-time number inside a CHECK (never user input). */
const n = (value: number) => sql.raw(String(value));
/** A compile-time list of words inside a CHECK (never user input). */
const words = (values: readonly string[]) => sql.raw(values.map((word) => `'${word}'`).join(", "));
/** A compile-time day inside a CHECK (never user input). */
const day = (value: string) => sql.raw(`'${value}'::date`);

// Defense in depth behind the Zod schemas (SPEC-learning "Modelo de datos"): raw SQL, scripts or a
// bug can't store an unknown kind or status, an empty or too long text, a finished time on a track
// that isn't done (or none on one that is), a link that isn't http(s) or a target out of range.
// «A practice has no steps» lives in Zod and the data layer: a CHECK can't read another table.

/**
 * L1: the study tracks (a certification, a course, a book or a practice). Soft delete
 * (`deleted_at`, with «Deshacer»); `position` orders the tracks inside their status.
 */
export const learningTracks = pgTable(
  "learning_tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(), // 1–120, normalized like names
    kind: text("kind", { enum: TRACK_KINDS }).notNull(),
    status: text("status", { enum: TRACK_STATUSES }).notNull().default("active"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    url: text("url"), // http(s), at most 2000, optional (the course's link; never followed)
    weeklyTargetMinutes: integer("weekly_target_minutes"), // 15–3000, optional
    targetDate: date("target_date"), // optional
    position: integer("position").notNull(), // order inside its status
    finishedAt: timestamp("finished_at", { withTimezone: true }), // only while status = 'done'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      // Stamped by the database clock on every Drizzle update. Raw SQL updates must set it themselves.
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "learning_tracks_title_check",
      sql`char_length(${table.title}) between 1 and ${n(TRACK_TITLE_MAX_LENGTH)}`,
    ),
    check("learning_tracks_kind_check", sql`${table.kind} in (${words(TRACK_KINDS)})`),
    check("learning_tracks_status_check", sql`${table.status} in (${words(TRACK_STATUSES)})`),
    // A finished time if and only if the track is done.
    check(
      "learning_tracks_finished_check",
      sql`(${table.status} = 'done') = (${table.finishedAt} is not null)`,
    ),
    // A link is http(s), without spaces, and not longer than the form accepts.
    check(
      "learning_tracks_url_check",
      sql`${table.url} is null or (${table.url} ~ '^https?://[^[:space:]]+$' and char_length(${table.url}) <= ${n(TRACK_URL_MAX_LENGTH)})`,
    ),
    check(
      "learning_tracks_weekly_target_check",
      sql`${table.weeklyTargetMinutes} is null or ${table.weeklyTargetMinutes} between ${n(WEEKLY_TARGET_MIN_MINUTES)} and ${n(WEEKLY_TARGET_MAX_MINUTES)}`,
    ),
    check(
      "learning_tracks_target_date_check",
      sql`${table.targetDate} is null or ${table.targetDate} between ${day(TARGET_DATE_MIN)} and ${day(TARGET_DATE_MAX)}`,
    ),
    check("learning_tracks_position_check", sql`${table.position} >= 0`),
    // The list: the live tracks of each status in their order.
    index("learning_tracks_status_idx")
      .on(table.status, table.position)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * L1: the syllabus of a track, a flat list of steps in order (classes, chapters, topics). The next
 * step is the first live one without `done_at`. Soft delete; `position` is contiguous (0…n-1) among
 * a track's live steps, under the track's lock (steps.ts).
 */
export const learningSteps = pgTable(
  "learning_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => learningTracks.id, { onDelete: "restrict" }),
    title: text("title").notNull(), // 1–200
    position: integer("position").notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "learning_steps_title_check",
      sql`char_length(${table.title}) between 1 and ${n(STEP_TITLE_MAX_LENGTH)}`,
    ),
    check("learning_steps_position_check", sql`${table.position} >= 0`),
    // A track's syllabus in order (the page, the next step and the counts).
    index("learning_steps_track_idx")
      .on(table.trackId, table.position)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export type LearningTrack = typeof learningTracks.$inferSelect;
export type NewLearningTrack = typeof learningTracks.$inferInsert;
export type LearningStep = typeof learningSteps.$inferSelect;
export type NewLearningStep = typeof learningSteps.$inferInsert;
