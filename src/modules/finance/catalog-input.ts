// Validation and client types of the catalog of `finance` (categories, payment methods and the
// USD → PEN rate; SPEC-finance "Categorías y medios", "Tipo de cambio"). Client-safe: the server
// actions are the authority, and the "Ajustes" sheet runs the same schemas first.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { CATALOG_ERRORS, RATE_ERRORS } from "./finance-copy";
import {
  CATALOG_NAME_MAX_LENGTH,
  CURRENCIES,
  MAX_CATALOG_ITEMS_IN_ORDER,
  type Currency,
} from "./finance-constants";
import { parseRate } from "./money";

/** The two lists of the catalog. Each has its own lock and its own unique names. */
export const CATALOG_KINDS = ["categories", "methods"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

/** A category as the screens get it (never the whole row). */
export type CategoryItem = { id: string; name: string; sortOrder: number };

/** A payment method, with the currency a new expense with it is in by default. */
export type PaymentMethodItem = CategoryItem & { currency: Currency };

/**
 * Everything the "Ajustes" sheet and the expense form need of the catalog: the visible
 * categories and methods in their order, the archived ones (most recently archived first), the
 * rate (ten-thousandths, null = not set) and the method of the last expense saved.
 */
export type FinanceCatalog = {
  categories: CategoryItem[];
  methods: PaymentMethodItem[];
  archivedCategories: CategoryItem[];
  archivedMethods: PaymentMethodItem[];
  usdToPenE4: number | null;
  lastPaymentMethodId: string | null;
};

const name = z
  .string({ error: CATALOG_ERRORS.nameRequired })
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, CATALOG_ERRORS.nameRequired)
      .max(CATALOG_NAME_MAX_LENGTH, CATALOG_ERRORS.nameTooLong)
      .refine((value) => !hasInvisibleCharacters(value), CATALOG_ERRORS.nameInvisible),
  );

const currency = z.enum(CURRENCIES, { error: CATALOG_ERRORS.currency });
const id = z.uuid({ error: CATALOG_ERRORS.notFound });

export const createCategoryInputSchema = z.object({ name });
export const renameCategoryInputSchema = z.object({ id, name });
export const createPaymentMethodInputSchema = z.object({ name, currency });
export const updatePaymentMethodInputSchema = z.object({ id, name, currency });

/** Archive (either list). */
export const catalogIdInputSchema = z.object({ id });

/** Reactivate ("Reactivar"): back at the end of its list. */
export const unarchiveCatalogInputSchema = z.object({ id });

/**
 * Reorder: every visible item's id of one list, in the new order, without repeats. The server
 * also checks they are exactly the visible ones (`planReorder`): a stale list is refused.
 */
export const reorderCatalogInputSchema = z.object({
  ids: z
    .array(z.uuid({ error: CATALOG_ERRORS.order }), { error: CATALOG_ERRORS.order })
    .min(1, CATALOG_ERRORS.order)
    .max(MAX_CATALOG_ITEMS_IN_ORDER, CATALOG_ERRORS.order)
    .refine((ids) => new Set(ids).size === ids.length, CATALOG_ERRORS.order),
});

/**
 * The USD → PEN rate as typed ("3.75", "3,7512"); empty clears it (null: USD expenses are then
 * summed apart, "sin convertir"). Out: ten-thousandths or null.
 */
export const setExchangeRateInputSchema = z.object({
  rate: z
    .string({ error: RATE_ERRORS.invalid })
    .nullable()
    .transform((value, context) => {
      if (value === null || value.trim() === "") return null;
      const parsed = parseRate(value);
      if (parsed.ok) return parsed.value;
      context.addIssue({ code: "custom", message: RATE_ERRORS[parsed.error] });
      return z.NEVER;
    }),
});

export type CreateCategoryInput = z.output<typeof createCategoryInputSchema>;
export type RenameCategoryInput = z.output<typeof renameCategoryInputSchema>;
export type CreatePaymentMethodInput = z.output<typeof createPaymentMethodInputSchema>;
export type UpdatePaymentMethodInput = z.output<typeof updatePaymentMethodInputSchema>;
