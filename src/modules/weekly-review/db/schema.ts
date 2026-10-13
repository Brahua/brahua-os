import { sql } from "drizzle-orm";
import { check, date, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { REVIEW_NOTE_MAX_LENGTH } from "../review-constants";

/** A compile-time number inside a CHECK (never user input). */
const n = (value: number) => sql.raw(String(value));

/**
 * W1: one row per reviewed week (SPEC-weekly-review "Modelo de datos"), keyed by its Monday in
 * Lima. Only the fact that the week was closed and an optional note: the numbers are computed
 * when the week is opened, never stored. No foreign keys, no soft delete (closing is idempotent
 * and there is no "reopen" in v1).
 */
export const weeklyReviews = pgTable(
  "weekly_reviews",
  {
    weekStart: date("week_start").primaryKey(), // a Monday in Lima
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    note: text("note"), // 1–280, optional
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (table) => [
    // ISO day of the week 1 = Monday.
    check("weekly_reviews_monday_check", sql`extract(isodow from ${table.weekStart}) = 1`),
    // A NULL note passes (a CHECK only fails on false); a present one is 1–280 characters.
    check(
      "weekly_reviews_note_length_check",
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(REVIEW_NOTE_MAX_LENGTH)}`,
    ),
  ],
);

export type WeeklyReview = typeof weeklyReviews.$inferSelect;
export type NewWeeklyReview = typeof weeklyReviews.$inferInsert;
