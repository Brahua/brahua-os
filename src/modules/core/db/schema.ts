import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
// Server-safe data module, not the barrel: keeps React components out of drizzle-kit and scripts.
import { AREA_COLORS, AREA_ICON_NAMES } from "@/design-system/areas";

export const lifeAreas = pgTable("core_life_areas", {
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
});

export type LifeArea = typeof lifeAreas.$inferSelect;
export type NewLifeArea = typeof lifeAreas.$inferInsert;
