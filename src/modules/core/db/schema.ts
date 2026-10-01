import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
// Server-safe data module, not the barrel: keeps React components out of drizzle-kit and scripts.
import { AREA_COLORS, AREA_ICON_NAMES } from "@/design-system/areas";
import { LIFE_AREA_NAME_MAX_LENGTH } from "../life-area-limits";

/** `'a', 'b', …` for an IN list. Only for these compile-time constants, never for user input. */
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", "));

export const lifeAreas = pgTable(
  "core_life_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(), // stable key for seeding/imports
    name: text("name").notNull(),
    // No defaults: actions and the seed always provide a valid icon and color.
    icon: text("icon", { enum: AREA_ICON_NAMES }).notNull(), // Lucide icon from the curated set
    color: text("color", { enum: AREA_COLORS }).notNull(), // one of the 8 area palettes
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      // Stamped by the database clock on every Drizzle update. Raw SQL updates must set it themselves.
      .$onUpdate(() => sql`now()`),
  },
  // Defense in depth behind the Zod schema: raw SQL, scripts or a bug can't store an unknown
  // color or icon, or an empty or too long name. The lists come from the same constants, so
  // adding a color or an icon changes these checks and needs a migration (`pnpm db:generate`).
  (table) => [
    check("core_life_areas_color_check", sql`${table.color} in (${sqlList(AREA_COLORS)})`),
    check("core_life_areas_icon_check", sql`${table.icon} in (${sqlList(AREA_ICON_NAMES)})`),
    check(
      "core_life_areas_name_length_check",
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(LIFE_AREA_NAME_MAX_LENGTH))}`,
    ),
  ],
);

export type LifeArea = typeof lifeAreas.$inferSelect;
export type NewLifeArea = typeof lifeAreas.$inferInsert;

// Better Auth tables live in their own file; re-exported so drizzle-kit and `db` see them.
export * from "./auth-schema";
