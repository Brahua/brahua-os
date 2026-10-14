// Validation of the shopping list's inputs (H2, SPEC-household). Client-safe: the forms run the same
// schemas before the server action, which is the authority; the database CHECKs are the last line.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { SHOPPING_ERRORS as ERRORS } from "./shopping-copy";
import {
  MAX_FINISH_ENTRIES,
  PRODUCT_CATEGORIES,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_QUANTITY_MAX_LENGTH,
  productKey,
} from "./shopping-constants";

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
      .refine((value) => codePoints(value) <= PRODUCT_NAME_MAX_LENGTH, ERRORS.nameTooLong)
      .refine((value) => !hasInvisibleCharacters(value), ERRORS.invisible)
      // The key is what the table checks: a name of only combining marks has an empty one.
      .refine((value) => {
        const key = productKey(value);
        return key !== "" && codePoints(key) <= PRODUCT_NAME_MAX_LENGTH;
      }, ERRORS.name),
  );

/**
 * A quantity as typed: "" and null mean none; otherwise normalized text up to 30 characters. A
 * MISSING one is not none: adding a known product without one keeps the quantity it had
 * (`addProductInputSchema` makes it optional), while `setQuantityInputSchema` requires it.
 */
const quantity = z.preprocess(
  (value) => (value === "" ? null : value),
  z
    .string({ error: ERRORS.quantity })
    .max(1000, ERRORS.quantityTooLong)
    .transform(normalizeName)
    .pipe(
      z
        .string()
        .refine((value) => codePoints(value) <= PRODUCT_QUANTITY_MAX_LENGTH, ERRORS.quantityTooLong)
        .refine((value) => !hasInvisibleCharacters(value), ERRORS.invisible),
    )
    // "   " normalizes to "": that is no quantity.
    .transform((value) => (value === "" ? null : value))
    .nullable(),
);

const category = z.enum(PRODUCT_CATEGORIES, { error: ERRORS.category });
const id = z.uuid({ error: ERRORS.notFound });
/** An instant as an ISO string (what «Deshacer» carries back). */
const instant = z.iso.datetime({ error: ERRORS.instant });

/** «Añadir producto»: a name, and optionally where it goes and how much. */
export const addProductInputSchema = z.object({
  name,
  category: category.optional(),
  quantity: quantity.optional(),
});
export type AddProductInput = z.output<typeof addProductInputSchema>;
export const ADD_PRODUCT_FIELDS = ["name", "category", "quantity"] as const;

export const productIdInputSchema = z.object({ id });
export const setBoughtInputSchema = z.object({ id, bought: z.boolean() });
export const setQuantityInputSchema = z.object({ id, quantity });

/** «Deshacer» of «Quitar de la lista»: back to what the row was (only while it is still idle). */
export const restoreToListInputSchema = z
  .object({
    id,
    previousStatus: z.enum(["needed", "bought"]),
    boughtAt: instant.nullable(),
  })
  .refine((value) => (value.previousStatus === "bought") === (value.boughtAt !== null), {
    message: ERRORS.instant,
    path: ["boughtAt"],
  });

/** «Deshacer» of «Terminé la compra»: the products it cleared, with when each was bought. */
export const undoFinishInputSchema = z.object({
  entries: z
    .array(z.object({ id, boughtAt: instant }))
    .max(MAX_FINISH_ENTRIES, ERRORS.tooMany)
    .refine((entries) => new Set(entries.map((entry) => entry.id)).size === entries.length, {
      message: ERRORS.duplicates,
    }),
});
export type FinishEntry = z.output<typeof undoFinishInputSchema>["entries"][number];
