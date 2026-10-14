import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_QUANTITY_MAX_LENGTH,
  PRODUCT_STATUSES,
} from "../shopping-constants";
import {
  MEAL_TYPES,
  RECIPE_NAME_MAX_LENGTH,
  RECIPE_URL_MAX_LENGTH,
  RECIPE_WEEKDAYS,
} from "../recipe-constants";

/** A compile-time number inside a CHECK (never user input). */
const n = (value: number) => sql.raw(String(value));
/** A compile-time list of words inside a CHECK (never user input). */
const words = (values: readonly string[]) => sql.raw(values.map((word) => `'${word}'`).join(", "));

/**
 * H2: the products of the shopping list (SPEC-household "Modelo de datos"). One row per product the
 * owner ever bought or listed: `idle` rows are the catalog that feeds the suggestions, `needed` the
 * list, `bought` what is checked off until «Terminé la compra». Soft delete (`deleted_at`): a
 * forgotten product stays in the export, and the same name can be added again.
 */
export const householdProducts = pgTable(
  "household_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // 1–80, normalized
    nameKey: text("name_key").notNull(), // lowercase without accents: uniqueness and suggestions
    category: text("category").notNull().default("otros"),
    quantity: text("quantity"), // 1–30, optional free text («2 kg», «1 docena»)
    status: text("status").notNull().default("needed"),
    boughtAt: timestamp("bought_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "household_products_name_check",
      sql`char_length(${table.name}) between 1 and ${n(PRODUCT_NAME_MAX_LENGTH)} and char_length(${table.nameKey}) between 1 and ${n(PRODUCT_NAME_MAX_LENGTH)} and ${table.nameKey} = lower(${table.nameKey})`,
    ),
    check(
      "household_products_category_check",
      sql`${table.category} in (${words(PRODUCT_CATEGORIES)})`,
    ),
    check("household_products_status_check", sql`${table.status} in (${words(PRODUCT_STATUSES)})`),
    check(
      "household_products_quantity_check",
      sql`${table.quantity} is null or char_length(${table.quantity}) between 1 and ${n(PRODUCT_QUANTITY_MAX_LENGTH)}`,
    ),
    // A product has a purchase time if and only if it is checked off.
    check(
      "household_products_bought_check",
      sql`(${table.status} = 'bought') = (${table.boughtAt} is not null)`,
    ),
    // One live product per name; a forgotten one frees its name.
    uniqueIndex("household_products_name_key_unique")
      .on(table.nameKey)
      .where(sql`${table.deletedAt} is null`),
    // The page's read: the live products by status.
    index("household_products_status_idx")
      .on(table.status)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export type HouseholdProduct = typeof householdProducts.$inferSelect;
export type NewHouseholdProduct = typeof householdProducts.$inferInsert;

/** A compile-time `text[]` literal inside a CHECK (never user input). */
const textArray = (values: readonly string[]) =>
  sql.raw(`ARRAY[${values.map((word) => `'${word}'`).join(", ")}]::text[]`);

/**
 * H3: the recipes (SPEC-household "Modelo de datos"): a name, the meals it suits, the weekdays it is
 * suggested for and an optional link. No ingredients, steps or plan (decision of the owner). Soft
 * delete (`deleted_at`); several recipes may share a name (no unique index).
 */
export const householdRecipes = pgTable(
  "household_recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(), // 1–120, normalized
    mealTypes: text("meal_types")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    weekdays: smallint("weekdays")
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`), // ISO 1–7
    url: text("url"), // http(s), at most 2000
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "household_recipes_name_check",
      sql`char_length(${table.name}) between 1 and ${n(RECIPE_NAME_MAX_LENGTH)}`,
    ),
    // Only the six meals, at most once each by size (a CHECK can't hold a subquery: the schema
    // dedupes, see recipe-input.ts).
    check(
      "household_recipes_meal_types_check",
      sql`${table.mealTypes} <@ ${textArray(MEAL_TYPES)} and cardinality(${table.mealTypes}) <= ${n(MEAL_TYPES.length)}`,
    ),
    // Only Monday to Sunday, at most seven.
    check(
      "household_recipes_weekdays_check",
      sql`${table.weekdays} <@ ARRAY[${sql.raw(RECIPE_WEEKDAYS.join(", "))}]::smallint[] and cardinality(${table.weekdays}) <= ${n(RECIPE_WEEKDAYS.length)}`,
    ),
    // A link is http(s), without spaces, and not longer than the form accepts.
    check(
      "household_recipes_url_check",
      sql`${table.url} is null or (${table.url} ~ '^https?://[^[:space:]]+$' and char_length(${table.url}) <= ${n(RECIPE_URL_MAX_LENGTH)})`,
    ),
    // The page's read: the live recipes by name.
    index("household_recipes_name_idx")
      .on(table.name)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export type HouseholdRecipe = typeof householdRecipes.$inferSelect;
export type NewHouseholdRecipe = typeof householdRecipes.$inferInsert;
