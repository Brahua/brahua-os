// How the shopping list is laid out (SPEC-household "Pantallas"): the list by category in the order
// the supermarket is walked, the checked-off products, the suggestions for the add field and the
// catalog of known products. Pure and client-safe.
import { CATEGORY_LABELS } from "./shopping-copy";
import { PRODUCT_CATEGORIES, productKey, type ProductCategory } from "./shopping-constants";

/** A product as the screen reads it (the same shape `products.ts` returns). */
export type ShoppingProduct = {
  id: string;
  name: string;
  category: ProductCategory;
  quantity: string | null;
  status: "idle" | "needed" | "bought";
};

export type CategoryGroup = {
  category: ProductCategory;
  label: string;
  products: ShoppingProduct[];
};

const byName = (a: ShoppingProduct, b: ShoppingProduct) =>
  productKey(a.name).localeCompare(productKey(b.name), "es") || a.id.localeCompare(b.id);

/** The products on the list (`needed`) in a section per category, in walking order; no empty ones. */
export function groupByCategory(products: readonly ShoppingProduct[]): CategoryGroup[] {
  return PRODUCT_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    products: products.filter((p) => p.status === "needed" && p.category === category).sort(byName),
  })).filter((group) => group.products.length > 0);
}

/** The checked-off products, by category order and then by name. */
export function boughtProducts(products: readonly ShoppingProduct[]): ShoppingProduct[] {
  const rank = (p: ShoppingProduct) => PRODUCT_CATEGORIES.indexOf(p.category);
  return products
    .filter((p) => p.status === "bought")
    .sort((a, b) => rank(a) - rank(b) || byName(a, b));
}

/** The known products that are not on the list, by name. */
export function knownProducts(products: readonly ShoppingProduct[]): ShoppingProduct[] {
  return products.filter((p) => p.status === "idle").sort(byName);
}

/** How many suggestions the add field shows at most. */
export const MAX_SUGGESTIONS = 5;

/**
 * The known products (not on the list) whose name starts with, or contains, what is being typed,
 * the ones that start with it first. Accents and capitals don't matter. Nothing for one letter.
 */
export function suggestionsFor(
  products: readonly ShoppingProduct[],
  typed: string,
): ShoppingProduct[] {
  const key = productKey(typed);
  if ([...key].length < 2) return [];
  const known = knownProducts(products);
  const starts = known.filter((p) => productKey(p.name).startsWith(key));
  const contains = known.filter(
    (p) => !productKey(p.name).startsWith(key) && productKey(p.name).includes(key),
  );
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

/** The product of that name already known (any status), or null: the add form reuses its category. */
export function findByName(
  products: readonly ShoppingProduct[],
  typed: string,
): ShoppingProduct | null {
  const key = productKey(typed);
  if (key === "") return null;
  return products.find((p) => productKey(p.name) === key) ?? null;
}
