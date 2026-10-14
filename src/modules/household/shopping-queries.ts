// Reads of the shopping list for Server Components. Checks the owner first (SPEC-core); the
// `select…` variant (products.ts) takes the database and trusts its caller.
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { selectProducts, type Product } from "./products";

export type { Product } from "./products";

/** The live products: the list (`needed`, `bought`) and the catalog (`idle`). */
export async function getProducts(): Promise<Product[]> {
  await requireOwner();
  return selectProducts(getDb());
}
