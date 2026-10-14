"use server";

// Server Actions of `household`'s shopping list (H2). Each one goes through ownerAction(): owner
// check first, Zod, then an ActionResult (SPEC-core "Estilo de código"). The data access is
// products.ts; every action revalidates /household.
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import {
  addProduct,
  finishShopping,
  forgetProduct,
  removeFromList,
  restoreProduct,
  restoreToList,
  setBought,
  setQuantity,
  undoFinishShopping,
  type AddedProduct,
  type FinishedShopping,
  type Product,
  type RemovedFromList,
  type UndoneFinish,
} from "./products";
import { revalidateHousehold } from "./revalidate";
import { SHOPPING_ERRORS } from "./shopping-copy";
import {
  addProductInputSchema,
  productIdInputSchema,
  restoreToListInputSchema,
  setBoughtInputSchema,
  setQuantityInputSchema,
  undoFinishInputSchema,
} from "./shopping-input";
import { z } from "zod";

const add = ownerAction(
  addProductInputSchema,
  async (data) => {
    const result = await addProduct(getDb(), data);
    revalidateHousehold();
    return ok(result);
  },
  { name: "addShoppingProduct" },
);

/**
 * Puts a product on the list: a new name creates it, an existing one (on the list, bought or just
 * known) is reused instead of duplicated. Two adds of the same name at once leave one row.
 */
export async function addShoppingProduct(input: unknown): Promise<ActionResult<AddedProduct>> {
  return add(input);
}

const bought = ownerAction(
  setBoughtInputSchema,
  async ({ id, bought: value }) => {
    const product = await setBought(getDb(), id, value);
    revalidateHousehold();
    return product ? ok(product) : fail<Product>(SHOPPING_ERRORS.notFound);
  },
  { name: "markProductBought" },
);

/** «Comprado»: checks a product off the list, or puts it back (idempotent). */
export async function markProductBought(input: unknown): Promise<ActionResult<Product>> {
  return bought(input);
}

const quantity = ownerAction(
  setQuantityInputSchema,
  async ({ id, quantity: value }) => {
    const product = await setQuantity(getDb(), id, value);
    revalidateHousehold();
    return product ? ok(product) : fail<Product>(SHOPPING_ERRORS.notFound);
  },
  { name: "changeProductQuantity" },
);

/** Sets or clears a product's quantity («2 kg»). */
export async function changeProductQuantity(input: unknown): Promise<ActionResult<Product>> {
  return quantity(input);
}

const remove = ownerAction(
  productIdInputSchema,
  async ({ id }) => {
    const removed = await removeFromList(getDb(), id);
    revalidateHousehold();
    return removed ? ok(removed) : fail<RemovedFromList>(SHOPPING_ERRORS.notFound);
  },
  { name: "removeProductFromShoppingList" },
);

/** «Quitar»: takes a product off the list; it stays known (for the suggestions). */
export async function removeProductFromShoppingList(
  input: unknown,
): Promise<ActionResult<RemovedFromList>> {
  return remove(input);
}

const putBack = ownerAction(
  restoreToListInputSchema,
  async ({ id, previousStatus, boughtAt }) => {
    const product = await restoreToList(getDb(), id, previousStatus, boughtAt);
    revalidateHousehold();
    return product ? ok(product) : fail<Product>(SHOPPING_ERRORS.notFound);
  },
  { name: "undoRemoveProduct" },
);

/** «Deshacer» of «Quitar»: back to what it was, only while it is still just known. */
export async function undoRemoveProduct(input: unknown): Promise<ActionResult<Product>> {
  return putBack(input);
}

const forget = ownerAction(
  productIdInputSchema,
  async ({ id }) => {
    const product = await forgetProduct(getDb(), id);
    revalidateHousehold();
    return product ? ok(product) : fail<Product>(SHOPPING_ERRORS.notFound);
  },
  { name: "forgetShoppingProduct" },
);

/** «Olvidar»: forgets a product for good (soft delete); its name can be added again. */
export async function forgetShoppingProduct(input: unknown): Promise<ActionResult<Product>> {
  return forget(input);
}

const unforget = ownerAction(
  productIdInputSchema,
  async ({ id }) => {
    const result = await restoreProduct(getDb(), id);
    revalidateHousehold();
    if (result === null) return fail<Product>(SHOPPING_ERRORS.notFound);
    return "taken" in result ? fail<Product>(SHOPPING_ERRORS.nameTaken) : ok(result.product);
  },
  { name: "undoForgetProduct" },
);

/** «Deshacer» of «Olvidar». */
export async function undoForgetProduct(input: unknown): Promise<ActionResult<Product>> {
  return unforget(input);
}

const finish = ownerAction(
  z.object({}),
  async () => {
    const result = await finishShopping(getDb());
    revalidateHousehold();
    return ok(result);
  },
  { name: "finishShoppingTrip" },
);

/** «Terminé la compra»: everything bought goes back to known, in one step. */
export async function finishShoppingTrip(
  input: unknown = {},
): Promise<ActionResult<FinishedShopping>> {
  return finish(input);
}

const undoFinish = ownerAction(
  undoFinishInputSchema,
  async ({ entries }) => {
    const result = await undoFinishShopping(getDb(), entries);
    revalidateHousehold();
    return ok(result);
  },
  { name: "undoFinishShoppingTrip" },
);

/** «Deshacer» of «Terminé la compra»: each product back to bought, only if still untouched. */
export async function undoFinishShoppingTrip(input: unknown): Promise<ActionResult<UndoneFinish>> {
  return undoFinish(input);
}
