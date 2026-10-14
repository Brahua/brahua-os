// How the recipes are laid out (SPEC-household "Pantallas"): «Para hoy» (the recipes suggested for
// today's weekday in Lima) and the filters by meal and by day, which live in the URL. Pure and
// client-safe.
import { MEAL_TYPES, type MealType } from "./recipe-constants";
import { MEAL_LABELS } from "./recipe-copy";

/** A recipe as the screen reads it (the shape `recipes.ts` returns). */
export type RecipeItem = {
  id: string;
  name: string;
  mealTypes: MealType[];
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  url: string | null;
};

/** `?tipo=` and `?dia=` filter the recipes (both may be set: a recipe must fit both). */
export const MEAL_PARAM = "tipo";
export const DAY_PARAM = "dia";

/** The meal of a `?tipo=` value, or null for anything unknown or missing. */
export function parseMeal(value: string | string[] | undefined): MealType | null {
  return typeof value === "string" && (MEAL_TYPES as readonly string[]).includes(value)
    ? (value as MealType)
    : null;
}

/** The weekday (ISO 1–7) of a `?dia=` value, or null for anything unknown or missing. */
export function parseDay(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-7]$/.test(value)) return null;
  return Number(value);
}

/** ISO weekday of a YYYY-MM-DD key: 1 = Monday … 7 = Sunday. */
export function isoWeekday(key: string): number {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The recipes that fit the filters (a filter that is null doesn't filter), by name. */
export function filterRecipes(
  recipes: readonly RecipeItem[],
  meal: MealType | null,
  day: number | null,
): RecipeItem[] {
  return recipes
    .filter(
      (recipe) =>
        (meal === null || recipe.mealTypes.includes(meal)) &&
        (day === null || recipe.weekdays.includes(day)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "es") || a.id.localeCompare(b.id));
}

/** The recipes suggested for the weekday of `today` (a Lima day key), by name. */
export function recipesForToday(recipes: readonly RecipeItem[], today: string): RecipeItem[] {
  return filterRecipes(recipes, null, isoWeekday(today));
}

/** The meals of a recipe as words, in the order of the day: «Almuerzo · Cena». */
export function mealsText(recipe: Pick<RecipeItem, "mealTypes">): string {
  return MEAL_TYPES.filter((meal) => recipe.mealTypes.includes(meal))
    .map((meal) => MEAL_LABELS[meal])
    .join(" · ");
}
