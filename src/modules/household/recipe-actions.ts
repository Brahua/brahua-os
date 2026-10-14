"use server";

// Server Actions of `household`'s recipes (H3). Each one goes through ownerAction(): owner check
// first, Zod, then an ActionResult (SPEC-core "Estilo de código"). The data access is recipes.ts;
// every action revalidates /household.
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { RECIPE_ERRORS } from "./recipe-copy";
import { addRecipeInputSchema, editRecipeInputSchema, recipeIdInputSchema } from "./recipe-input";
import { deleteRecipe, insertRecipe, restoreRecipe, updateRecipe, type Recipe } from "./recipes";
import { revalidateHousehold } from "./revalidate";

const add = ownerAction(
  addRecipeInputSchema,
  async (data) => {
    const recipe = await insertRecipe(getDb(), data);
    revalidateHousehold();
    return ok(recipe);
  },
  { name: "addRecipe" },
);

/** Adds a recipe: a name, the meals and weekdays it suits and an optional http(s) link. */
export async function addRecipe(input: unknown): Promise<ActionResult<Recipe>> {
  return add(input);
}

const edit = ownerAction(
  editRecipeInputSchema,
  async ({ id, ...data }) => {
    const recipe = await updateRecipe(getDb(), id, data);
    revalidateHousehold();
    return recipe ? ok(recipe) : fail<Recipe>(RECIPE_ERRORS.notFound);
  },
  { name: "editRecipe" },
);

/** Saves a recipe's fields (the sheet sends them all). */
export async function editRecipe(input: unknown): Promise<ActionResult<Recipe>> {
  return edit(input);
}

const remove = ownerAction(
  recipeIdInputSchema,
  async ({ id }) => {
    const recipe = await deleteRecipe(getDb(), id);
    revalidateHousehold();
    return recipe ? ok(recipe) : fail<Recipe>(RECIPE_ERRORS.notFound);
  },
  { name: "removeRecipe" },
);

/** «Quitar»: deletes the recipe (it stays in the export). */
export async function removeRecipe(input: unknown): Promise<ActionResult<Recipe>> {
  return remove(input);
}

const undoRemove = ownerAction(
  recipeIdInputSchema,
  async ({ id }) => {
    const recipe = await restoreRecipe(getDb(), id);
    revalidateHousehold();
    return recipe ? ok(recipe) : fail<Recipe>(RECIPE_ERRORS.notFound);
  },
  { name: "undoRemoveRecipe" },
);

/** «Deshacer» of «Quitar». */
export async function undoRemoveRecipe(input: unknown): Promise<ActionResult<Recipe>> {
  return undoRemove(input);
}
