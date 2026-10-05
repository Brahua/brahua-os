"use server";

// Server Actions of the catalog of `finance` ("Ajustes": categories, payment methods and the USD →
// PEN rate). Each goes through ownerAction() (owner first, Zod, an ActionResult) and, when it
// works, returns the whole catalog as it is now: the sheet shows exactly what is stored.
import { z } from "zod";
import { ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import {
  archiveCatalogItem,
  insertCategory,
  insertPaymentMethod,
  renameCategory as renameCategoryById,
  reorderCatalog,
  selectCatalog,
  setUsdToPen,
  unarchiveCatalogItem,
  updatePaymentMethod as updatePaymentMethodById,
  type CatalogFailure,
} from "./catalog";
import {
  catalogIdInputSchema,
  createCategoryInputSchema,
  createPaymentMethodInputSchema,
  renameCategoryInputSchema,
  reorderCatalogInputSchema,
  setExchangeRateInputSchema,
  unarchiveCatalogInputSchema,
  updatePaymentMethodInputSchema,
  type CatalogKind,
  type FinanceCatalog,
} from "./catalog-input";
import { catalogRefused } from "./failures";
import { revalidateFinanceScreens } from "./revalidate";

type Result = ActionResult<FinanceCatalog>;

/** Runs a write of one list, revalidates and answers with the fresh catalog (or why not). */
async function afterWrite(kind: CatalogKind, outcome: unknown): Promise<Result> {
  revalidateFinanceScreens();
  if (typeof outcome === "string") return catalogRefused(kind, outcome as CatalogFailure);
  return ok(await selectCatalog(getDb()));
}

const read = ownerAction(z.object({}), async () => ok(await selectCatalog(getDb())), {
  name: "readFinanceCatalog",
});

/**
 * The catalog for a form opened from any screen (the quick capture): read when it opens, so it is
 * always up to date and no page has to load it ahead of time.
 */
export async function readFinanceCatalog(input: unknown): Promise<Result> {
  return read(input);
}

const createCat = ownerAction(
  createCategoryInputSchema,
  async (data) => afterWrite("categories", await insertCategory(getDb(), data)),
  { name: "createFinanceCategory" },
);

/** A new category at the end of the list (a visible one with the same name is refused). */
export async function createCategory(input: unknown): Promise<Result> {
  return createCat(input);
}

const renameCat = ownerAction(
  renameCategoryInputSchema,
  async (data) => afterWrite("categories", await renameCategoryById(getDb(), data)),
  { name: "renameFinanceCategory" },
);

/** Renames a visible category. */
export async function renameCategory(input: unknown): Promise<Result> {
  return renameCat(input);
}

const createMethod = ownerAction(
  createPaymentMethodInputSchema,
  async (data) => afterWrite("methods", await insertPaymentMethod(getDb(), data)),
  { name: "createFinancePaymentMethod" },
);

/** A new payment method (with its default currency) at the end of the list. */
export async function createPaymentMethod(input: unknown): Promise<Result> {
  return createMethod(input);
}

const updateMethod = ownerAction(
  updatePaymentMethodInputSchema,
  async (data) => afterWrite("methods", await updatePaymentMethodById(getDb(), data)),
  { name: "updateFinancePaymentMethod" },
);

/** Renames a visible payment method and sets its default currency. */
export async function updatePaymentMethod(input: unknown): Promise<Result> {
  return updateMethod(input);
}

function reorderAction(kind: CatalogKind) {
  return ownerAction(
    reorderCatalogInputSchema,
    async ({ ids }) => afterWrite(kind, await reorderCatalog(getDb(), kind, ids)),
    { name: `reorderFinance-${kind}` },
  );
}
const reorderCats = reorderAction("categories");
const reorderMethods = reorderAction("methods");

/** Every visible category's id in the new order (a stale list is refused, writing nothing). */
export async function reorderCategories(input: unknown): Promise<Result> {
  return reorderCats(input);
}

/** Every visible payment method's id in the new order. */
export async function reorderPaymentMethods(input: unknown): Promise<Result> {
  return reorderMethods(input);
}

function archiveAction(kind: CatalogKind) {
  return ownerAction(
    catalogIdInputSchema,
    async ({ id }) => afterWrite(kind, await archiveCatalogItem(getDb(), kind, id)),
    { name: `archiveFinance-${kind}` },
  );
}
const archiveCat = archiveAction("categories");
const archiveMethod = archiveAction("methods");

/** Archives a category: out of the form, its expenses untouched. Twice is fine. */
export async function archiveCategory(input: unknown): Promise<Result> {
  return archiveCat(input);
}

/** Archives a payment method. */
export async function archivePaymentMethod(input: unknown): Promise<Result> {
  return archiveMethod(input);
}

function unarchiveAction(kind: CatalogKind) {
  return ownerAction(
    unarchiveCatalogInputSchema,
    async (data) => afterWrite(kind, await unarchiveCatalogItem(getDb(), kind, data)),
    { name: `unarchiveFinance-${kind}` },
  );
}
const unarchiveCat = unarchiveAction("categories");
const unarchiveMethod = unarchiveAction("methods");

/** Reactivates a category (at the end, or in its place for an undo). */
export async function unarchiveCategory(input: unknown): Promise<Result> {
  return unarchiveCat(input);
}

/** Reactivates a payment method. */
export async function unarchivePaymentMethod(input: unknown): Promise<Result> {
  return unarchiveMethod(input);
}

const setRate = ownerAction(
  setExchangeRateInputSchema,
  async ({ rate }) => {
    await setUsdToPen(getDb(), rate);
    revalidateFinanceScreens();
    return ok(await selectCatalog(getDb()));
  },
  { name: "setFinanceExchangeRate" },
);

/** Sets the USD → PEN rate ("3.75"), or clears it (empty). Only new USD expenses use it. */
export async function setExchangeRate(input: unknown): Promise<Result> {
  return setRate(input);
}
