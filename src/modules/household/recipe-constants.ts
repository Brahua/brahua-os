// Plain constants of the recipes (H3, SPEC-household "Modelo de datos"), shared by the Zod schemas,
// the screens and the database CHECK constraints. No server code: the client imports them.

/** The meals of the owner's Notion, in the order of the day. */
export const MEAL_TYPES = [
  "breakfast",
  "midmorning",
  "lunch",
  "afternoon",
  "snack",
  "dinner",
] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export const RECIPE_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const RECIPE_NAME_MAX_LENGTH = 120;
export const RECIPE_URL_MAX_LENGTH = 2000;
/** The page reads at most this many recipes (a household has dozens, never thousands). */
export const MAX_RECIPES = 500;
