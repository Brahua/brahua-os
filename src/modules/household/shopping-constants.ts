// Plain constants of the shopping list (H2, SPEC-household "Modelo de datos"), shared by the Zod
// schemas, the screens and the database CHECK constraints. No server code: the client imports them.

/**
 * The categories of the owner's Notion, in the order the supermarket is walked (a fixed list in
 * code, SPEC-household supuesto 2; editing it is backlog). A product has exactly one.
 */
export const PRODUCT_CATEGORIES = [
  "verduras",
  "frutas",
  "carnes",
  "lacteos",
  "especerias",
  "productos_naturales",
  "limpieza",
  "otros",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** `idle`: known and not on the list · `needed`: on the list · `bought`: checked off. */
export const PRODUCT_STATUSES = ["idle", "needed", "bought"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_NAME_MAX_LENGTH = 80;
export const PRODUCT_QUANTITY_MAX_LENGTH = 30;
/** «Terminé la compra» and its undo carry at most this many products. */
export const MAX_FINISH_ENTRIES = 500;
/** The page reads at most this many products (a household has hundreds, never thousands). */
export const MAX_PRODUCTS = 1000;

/** The name as a key: lowercase, no accents, whitespace collapsed ("Café " and "cafe" are one). */
export function productKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}
