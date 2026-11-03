import { sql } from "drizzle-orm";
import {
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
// `notes` depends on `core` (SPEC-notes "Modelo de datos"): a knowledge note may belong to a life
// area through a foreign key, like goals, habits and projects.
import { lifeAreas } from "@/modules/core/db/schema";
import {
  NOTE_BODY_MAX_LENGTH,
  NOTE_DAY_MAX,
  NOTE_DAY_MIN,
  NOTE_KINDS,
  NOTE_TITLE_MAX_LENGTH,
} from "../note-constants";

/** A compile-time number inside a CHECK (never user input). */
const n = (value: number) => sql.raw(String(value));
/** A compile-time list of words inside a CHECK (never user input). */
const words = (values: readonly string[]) => sql.raw(values.map((word) => `'${word}'`).join(", "));
/** A compile-time day inside a CHECK (never user input). */
const day = (value: string) => sql.raw(`'${value}'::date`);

// Defense in depth behind the Zod schemas (SPEC-notes "Modelo de datos"): raw SQL, scripts or a
// bug can't store an unknown kind, a daily note without its day (or a page with one), a page
// without a title (or a daily note with one), a body or title over the limit, an area or a pin on
// a daily note, or a version below 1. NUL and bidi controls are refused by Zod (the same function
// as projects' notes, src/lib/markdown-text.ts); Postgres itself refuses NUL in text.

/**
 * N1: the notes. One table, two kinds: `daily` (one per Lima day, its title is the date) and `page`
 * (a knowledge note with a title, an optional life area and a pin). `version` grows by one on
 * every save of the body (the autosave writes only if it still holds the version it edited).
 * Soft delete (`deleted_at`, with «Deshacer»). N4 adds the generated `search` column.
 */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: NOTE_KINDS }).notNull(),
    day: date("day"), // if and only if kind = 'daily'
    title: text("title"), // 1–120, if and only if kind = 'page'
    body: text("body").notNull().default(""), // Markdown, ≤ 50 000
    areaId: uuid("area_id").references(() => lifeAreas.id, { onDelete: "restrict" }), // page only
    pinnedAt: timestamp("pinned_at", { withTimezone: true }), // page only
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // The last EDIT (the body or the title), which orders the list. No `$onUpdate` on purpose:
    // pinning, the area, deleting and restoring must not move a note up as «edited»; notes.ts
    // stamps it by hand where the body or the title change.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("notes_kind_check", sql`${table.kind} in (${words(NOTE_KINDS)})`),
    // A day if and only if it is a daily note, inside the range the app accepts.
    check(
      "notes_day_check",
      sql`(${table.kind} = 'daily') = (${table.day} is not null) and (${table.day} is null or ${table.day} between ${day(NOTE_DAY_MIN)} and ${day(NOTE_DAY_MAX)})`,
    ),
    // A title if and only if it is a knowledge note.
    check(
      "notes_title_check",
      sql`(${table.kind} = 'page') = (${table.title} is not null) and (${table.title} is null or char_length(${table.title}) between 1 and ${n(NOTE_TITLE_MAX_LENGTH)})`,
    ),
    check("notes_body_check", sql`char_length(${table.body}) <= ${n(NOTE_BODY_MAX_LENGTH)}`),
    // A daily note has no area and no pin.
    check(
      "notes_page_fields_check",
      sql`${table.kind} = 'page' or (${table.areaId} is null and ${table.pinnedAt} is null)`,
    ),
    check("notes_version_check", sql`${table.version} >= 1`),
    // One live note per day (SPEC-notes "Unicidad del día"): a deleted one doesn't block another.
    uniqueIndex("notes_daily_day_unique")
      .on(table.day)
      .where(sql`${table.kind} = 'daily' and ${table.deletedAt} is null`),
    // The list: live notes by last edit.
    index("notes_updated_idx")
      .on(table.updatedAt)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export type NoteRow = typeof notes.$inferSelect;
