// Data access of the shopping list (H2; server only). These functions take the database and trust
// their input: the actions check the owner and validate with Zod first (shopping-input.ts).
//
// Locks: adding or restoring a product takes `(7000, hashtext(<name_key>))` as the FIRST lock of its
// transaction (lock-keys.ts); the partial unique index on `name_key` is the safety net. Every other
// write is one conditional UPDATE: it changes only the row that is still in the state the caller
// saw, so a stale tap or an undo never overwrites what was changed by hand.
import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { householdProducts } from "./db/schema";
import { HOUSEHOLD_ADVISORY_SPACE, productLockKey } from "./lock-keys";
import {
  MAX_PRODUCTS,
  productKey,
  type ProductCategory,
  type ProductStatus,
} from "./shopping-constants";
import type { AddProductInput, FinishEntry } from "./shopping-input";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A product as the screens get it (never the whole row). */
export type Product = {
  id: string;
  name: string;
  category: ProductCategory;
  quantity: string | null;
  status: ProductStatus;
};

const live = isNull(householdProducts.deletedAt);

const COLUMNS = {
  id: householdProducts.id,
  name: householdProducts.name,
  category: householdProducts.category,
  quantity: householdProducts.quantity,
  status: householdProducts.status,
};

type Row = Pick<typeof householdProducts.$inferSelect, keyof typeof COLUMNS>;

function toProduct(row: Row): Product {
  return {
    id: row.id,
    name: row.name,
    category: row.category as ProductCategory,
    quantity: row.quantity,
    status: row.status as ProductStatus,
  };
}

/** The name's lock. Must be the first lock of the transaction. */
function lockName(tx: Tx, nameKey: string) {
  return tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(HOUSEHOLD_ADVISORY_SPACE))}, hashtext(${productLockKey(nameKey)}))`,
  );
}

/** The live products (at most 1000), the catalog and the list in one read. */
export async function selectProducts(db: Database): Promise<Product[]> {
  const rows = await db
    .select(COLUMNS)
    .from(householdProducts)
    .where(live)
    .orderBy(asc(householdProducts.nameKey), asc(householdProducts.id))
    .limit(MAX_PRODUCTS);
  return rows.map(toProduct);
}

export type AddedProduct = {
  product: Product;
  /** A new row (false: the name already existed). */
  created: boolean;
  /** It was already on the list (`needed`): nothing changed but maybe the quantity or category. */
  alreadyOnList: boolean;
};

/**
 * Puts a product on the list. A name that exists (live, any status) is reused instead of
 * duplicated: it goes back to `needed` (a bought one is unchecked) and keeps its category and
 * quantity unless the input gives them. A new name creates the row (category «otros» by default).
 */
export async function addProduct(db: Database, input: AddProductInput): Promise<AddedProduct> {
  const nameKey = productKey(input.name);
  return db.transaction(async (tx) => {
    await lockName(tx, nameKey);
    const [existing] = await tx
      .select({ ...COLUMNS })
      .from(householdProducts)
      .where(and(eq(householdProducts.nameKey, nameKey), live))
      .for("update");
    if (!existing) {
      const [created] = await tx
        .insert(householdProducts)
        .values({
          name: input.name,
          nameKey,
          category: input.category ?? "otros",
          quantity: input.quantity ?? null,
          status: "needed",
        })
        .returning(COLUMNS);
      return { product: toProduct(created), created: true, alreadyOnList: false };
    }
    const alreadyOnList = existing.status === "needed";
    const [updated] = await tx
      .update(householdProducts)
      .set({
        status: "needed",
        boughtAt: null,
        category: input.category ?? existing.category,
        quantity: input.quantity === undefined ? existing.quantity : input.quantity,
      })
      .where(eq(householdProducts.id, existing.id))
      .returning(COLUMNS);
    return { product: toProduct(updated), created: false, alreadyOnList };
  });
}

/**
 * Checks a product off (`bought`) or puts it back (`needed`). Only a product on the list changes:
 * an `idle` or forgotten one is left alone (null), and checking a bought one again keeps the first
 * purchase time. Idempotent.
 */
export async function setBought(
  db: Database,
  id: string,
  bought: boolean,
): Promise<Product | null> {
  const [row] = await db
    .update(householdProducts)
    .set(
      bought
        ? { status: "bought", boughtAt: sql`coalesce(${householdProducts.boughtAt}, now())` }
        : { status: "needed", boughtAt: null },
    )
    .where(
      and(
        eq(householdProducts.id, id),
        live,
        inArray(householdProducts.status, ["needed", "bought"]),
      ),
    )
    .returning(COLUMNS);
  return row ? toProduct(row) : null;
}

/** Sets or clears the quantity of a live product. Null when it isn't there. */
export async function setQuantity(
  db: Database,
  id: string,
  quantity: string | null,
): Promise<Product | null> {
  const [row] = await db
    .update(householdProducts)
    .set({ quantity })
    .where(and(eq(householdProducts.id, id), live))
    .returning(COLUMNS);
  return row ? toProduct(row) : null;
}

export type RemovedFromList = {
  product: Product;
  /** What it was, so «Deshacer» can put it back exactly. */
  previousStatus: "needed" | "bought";
  previousBoughtAt: string | null;
};

/**
 * «Quitar de la lista»: a `needed` or `bought` product becomes `idle` (it stays known, for the
 * suggestions). Null when it isn't on the list.
 */
export async function removeFromList(db: Database, id: string): Promise<RemovedFromList | null> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: householdProducts.status, boughtAt: householdProducts.boughtAt })
      .from(householdProducts)
      .where(
        and(
          eq(householdProducts.id, id),
          live,
          inArray(householdProducts.status, ["needed", "bought"]),
        ),
      )
      .for("update");
    if (!before) return null;
    const [row] = await tx
      .update(householdProducts)
      .set({ status: "idle", boughtAt: null })
      .where(eq(householdProducts.id, id))
      .returning(COLUMNS);
    return {
      product: toProduct(row),
      previousStatus: before.status as "needed" | "bought",
      previousBoughtAt: before.boughtAt?.toISOString() ?? null,
    };
  });
}

/**
 * «Deshacer» of `removeFromList`: puts the product back to what it was, but only while it is still
 * `idle` (one put back on the list by hand meanwhile is left as it is). Null when not restored.
 */
export async function restoreToList(
  db: Database,
  id: string,
  previousStatus: "needed" | "bought",
  previousBoughtAt: string | null,
): Promise<Product | null> {
  const [row] = await db
    .update(householdProducts)
    .set({
      status: previousStatus,
      boughtAt: previousStatus === "bought" && previousBoughtAt ? new Date(previousBoughtAt) : null,
    })
    .where(and(eq(householdProducts.id, id), live, eq(householdProducts.status, "idle")))
    .returning(COLUMNS);
  return row ? toProduct(row) : null;
}

/** Forgets a product (soft delete): it leaves the list and the suggestions. Null if not there. */
export async function forgetProduct(db: Database, id: string): Promise<Product | null> {
  const [row] = await db
    .update(householdProducts)
    .set({ status: "idle", boughtAt: null, deletedAt: sql`now()` })
    .where(and(eq(householdProducts.id, id), live))
    .returning(COLUMNS);
  return row ? toProduct(row) : null;
}

export type RestoredProduct = { product: Product } | { taken: true } | null;

/**
 * «Deshacer» of `forgetProduct`: brings it back as `idle`. If a live product took its name in the
 * meantime it stays forgotten (`taken`): two live rows of one name can't exist. Null when it
 * isn't a forgotten product.
 */
export async function restoreProduct(db: Database, id: string): Promise<RestoredProduct> {
  return db.transaction(async (tx) => {
    const [forgotten] = await tx
      .select({ nameKey: householdProducts.nameKey })
      .from(householdProducts)
      .where(eq(householdProducts.id, id));
    if (!forgotten) return null;
    await lockName(tx, forgotten.nameKey);
    const [current] = await tx
      .select({ deletedAt: householdProducts.deletedAt })
      .from(householdProducts)
      .where(eq(householdProducts.id, id))
      .for("update");
    if (!current) return null;
    // Restoring one that is not deleted changes nothing (a second «Deshacer»).
    if (current.deletedAt === null) {
      const [same] = await tx
        .select(COLUMNS)
        .from(householdProducts)
        .where(eq(householdProducts.id, id));
      return { product: toProduct(same) };
    }
    const [taken] = await tx
      .select({ id: householdProducts.id })
      .from(householdProducts)
      .where(and(eq(householdProducts.nameKey, forgotten.nameKey), live));
    if (taken) return { taken: true };
    const [row] = await tx
      .update(householdProducts)
      .set({ deletedAt: null, status: "idle", boughtAt: null })
      .where(eq(householdProducts.id, id))
      .returning(COLUMNS);
    return { product: toProduct(row) };
  });
}

export type FinishedShopping = { entries: FinishEntry[] };

/**
 * «Terminé la compra»: every `bought` product becomes `idle` in one UPDATE (they stay known). The
 * answer carries what the undo needs: each product's id and when it was bought.
 */
export async function finishShopping(db: Database): Promise<FinishedShopping> {
  return db.transaction(async (tx) => {
    const bought = await tx
      .select({ id: householdProducts.id, boughtAt: householdProducts.boughtAt })
      .from(householdProducts)
      .where(and(eq(householdProducts.status, "bought"), live))
      // A fixed order: two finishes at once take the row locks in the same one.
      .orderBy(asc(householdProducts.id))
      .for("update");
    if (bought.length === 0) return { entries: [] };
    await tx
      .update(householdProducts)
      .set({ status: "idle", boughtAt: null })
      .where(
        inArray(
          householdProducts.id,
          bought.map((row) => row.id),
        ),
      );
    return {
      entries: bought.map((row) => ({
        id: row.id,
        boughtAt: (row.boughtAt as Date).toISOString(),
      })),
    };
  });
}

export type UndoneFinish = { restored: string[]; kept: string[] };

/**
 * «Deshacer» of `finishShopping`: each product goes back to `bought` with the time it had, but only
 * while it is still `idle`; one the owner put on the list again, removed or forgot meanwhile is left
 * as it is and reported in `kept`.
 */
export async function undoFinishShopping(
  db: Database,
  entries: readonly FinishEntry[],
): Promise<UndoneFinish> {
  const restored: string[] = [];
  const kept: string[] = [];
  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const [row] = await tx
        .update(householdProducts)
        .set({ status: "bought", boughtAt: new Date(entry.boughtAt) })
        .where(and(eq(householdProducts.id, entry.id), live, eq(householdProducts.status, "idle")))
        .returning({ id: householdProducts.id });
      (row ? restored : kept).push(entry.id);
    }
  });
  return { restored, kept };
}
