// Validation of the recipes' inputs (H3, SPEC-household). Client-safe: the sheet runs the same
// schemas before the server action, which is the authority; the database CHECKs are the last line.
// Lists are sets here (a CHECK can't hold a subquery): no repeats, sorted, the weekdays ISO 1–7.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { MEAL_TYPES, RECIPE_NAME_MAX_LENGTH, RECIPE_WEEKDAYS } from "./recipe-constants";
import { RECIPE_ERRORS as ERRORS } from "./recipe-copy";
import { acceptableRecipeUrl } from "./recipe-url";

/** Length in characters as Postgres counts them (code points, not UTF-16 units). */
const codePoints = (value: string) => [...value].length;

const name = z
  .string({ error: ERRORS.name })
  .max(1000, ERRORS.nameTooLong)
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, ERRORS.name)
      .refine((value) => codePoints(value) <= RECIPE_NAME_MAX_LENGTH, ERRORS.nameTooLong)
      .refine((value) => !hasInvisibleCharacters(value), ERRORS.invisible),
  );

/** The meals, without repeats and in the order of the day. */
const mealTypes = z
  .array(z.enum(MEAL_TYPES, { error: ERRORS.meals }), { error: ERRORS.meals })
  .max(MEAL_TYPES.length, ERRORS.meals)
  .transform((values) => MEAL_TYPES.filter((meal) => values.includes(meal)));

/** The weekdays (ISO 1–7), without repeats and sorted. */
const weekdays = z
  .array(
    z
      .number({ error: ERRORS.weekdays })
      .int(ERRORS.weekdays)
      .min(1, ERRORS.weekdays)
      .max(7, ERRORS.weekdays),
    {
      error: ERRORS.weekdays,
    },
  )
  .max(RECIPE_WEEKDAYS.length * 2, ERRORS.weekdays)
  .transform((values) => RECIPE_WEEKDAYS.filter((day) => values.includes(day)));

/** The link: "" and null mean none; otherwise an acceptable http(s) link (recipe-url.ts). */
const url = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string({ error: ERRORS.url })
    .refine((value) => acceptableRecipeUrl(value) !== null, ERRORS.url)
    // What is stored is the normalized link (scheme in lowercase), the one the table accepts.
    .transform((value) => acceptableRecipeUrl(value) as string)
    .nullable(),
);

const id = z.uuid({ error: ERRORS.notFound });

export const recipeFieldsSchema = z.object({
  name,
  mealTypes: mealTypes.default([]),
  weekdays: weekdays.default([]),
  url: url.default(null),
});
export type RecipeFields = z.output<typeof recipeFieldsSchema>;
export const RECIPE_FIELDS = ["name", "mealTypes", "weekdays", "url"] as const;

export const addRecipeInputSchema = recipeFieldsSchema;
export const editRecipeInputSchema = recipeFieldsSchema.extend({ id });
export const recipeIdInputSchema = z.object({ id });
