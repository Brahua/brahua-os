import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { AREA_COLORS, AREA_ICON_NAMES } from "@/design-system";

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
    .$onUpdate(() => new Date()),
});

export type LifeArea = typeof lifeAreas.$inferSelect;
export type NewLifeArea = typeof lifeAreas.$inferInsert;
