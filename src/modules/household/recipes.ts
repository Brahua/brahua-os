// Data access of the recipes (H3; server only). These functions take the database and trust their
// input: the actions check the owner and validate with Zod first (recipe-input.ts). No advisory
// lock: nothing here has to be unique, and every write is one statement on one row.
import "server-only";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { householdRecipes } from "./db/schema";
import { MAX_RECIPES, type MealType } from "./recipe-constants";
import type { RecipeFields } from "./recipe-input";

/** A recipe as the screens get it (never the whole row). */
export type Recipe = {
  id: string;
  name: string;
  mealTypes: MealType[];
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  url: string | null;
};

const live = isNull(householdRecipes.deletedAt);

const COLUMNS = {
  id: householdRecipes.id,
  name: householdRecipes.name,
  mealTypes: householdRecipes.mealTypes,
  weekdays: householdRecipes.weekdays,
  url: householdRecipes.url,
};

type Row = Pick<typeof householdRecipes.$inferSelect, keyof typeof COLUMNS>;

function toRecipe(row: Row): Recipe {
  return {
    id: row.id,
    name: row.name,
    mealTypes: row.mealTypes as MealType[],
    weekdays: [...row.weekdays].sort((a, b) => a - b),
    url: row.url,
  };
}

/** The live recipes (at most 500), by name. */
export async function selectRecipes(db: Database): Promise<Recipe[]> {
  const rows = await db
    .select(COLUMNS)
    .from(householdRecipes)
    .where(live)
    .orderBy(asc(householdRecipes.name), asc(householdRecipes.id))
    .limit(MAX_RECIPES);
  return rows.map(toRecipe);
}

export async function insertRecipe(db: Database, input: RecipeFields): Promise<Recipe> {
  const [row] = await db
    .insert(householdRecipes)
    .values({
      name: input.name,
      mealTypes: input.mealTypes,
      weekdays: input.weekdays,
      url: input.url,
    })
    .returning(COLUMNS);
  return toRecipe(row);
}

/** Replaces the fields of a live recipe (the form sends them all). Null when it isn't there. */
export async function updateRecipe(
  db: Database,
  id: string,
  input: RecipeFields,
): Promise<Recipe | null> {
  const [row] = await db
    .update(householdRecipes)
    .set({
      name: input.name,
      mealTypes: input.mealTypes,
      weekdays: input.weekdays,
      url: input.url,
    })
    .where(and(eq(householdRecipes.id, id), live))
    .returning(COLUMNS);
  return row ? toRecipe(row) : null;
}

/** Soft delete: the recipe leaves the list and stays in the export. Null if it isn't there. */
export async function deleteRecipe(db: Database, id: string): Promise<Recipe | null> {
  const [row] = await db
    .update(householdRecipes)
    .set({ deletedAt: new Date() })
    .where(and(eq(householdRecipes.id, id), live))
    .returning(COLUMNS);
  return row ? toRecipe(row) : null;
}

/**
 * «Deshacer» of `deleteRecipe`. Restoring one that is not deleted changes nothing (a second
 * «Deshacer» is not an error). Null only when the recipe doesn't exist at all.
 */
export async function restoreRecipe(db: Database, id: string): Promise<Recipe | null> {
  const [row] = await db
    .update(householdRecipes)
    .set({ deletedAt: null })
    .where(and(eq(householdRecipes.id, id), isNotNull(householdRecipes.deletedAt)))
    .returning(COLUMNS);
  if (row) return toRecipe(row);
  const [current] = await db
    .select(COLUMNS)
    .from(householdRecipes)
    .where(eq(householdRecipes.id, id));
  return current ? toRecipe(current) : null;
}
