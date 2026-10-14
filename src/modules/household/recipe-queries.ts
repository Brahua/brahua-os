// Reads of the recipes for Server Components. Checks the owner first (SPEC-core); the `select…`
// variant (recipes.ts) takes the database and trusts its caller.
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { selectRecipes, type Recipe } from "./recipes";

export type { Recipe } from "./recipes";

/** The live recipes, by name. */
export async function getRecipes(): Promise<Recipe[]> {
  await requireOwner();
  return selectRecipes(getDb());
}
