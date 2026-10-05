// The catalog of `finance` (server only): categories, payment methods and the settings row (the
// USD → PEN rate, the last method used). Like the other modules' data access, these functions
// take the database and trust their input: the actions check the owner and validate first.
//
// Locks (CLAUDE.md "Advisory locks"; SPEC-finance "Bloqueos"), all in `FINANCE_ADVISORY_SPACE`:
// - `(5000, hashtext('finance:categories'))` and `(5000, hashtext('finance:methods'))`: anything
//   that creates, renames, reorders, archives or reactivates an item of that list. Keeps
//   `sort_order` contiguous and makes the "name taken" check race-free (the unique index on
//   lower(name) among the visible ones is the defense behind it).
// - F2: `(5000, hashtext(<recurring id>))` for one recurring payment (pay, skip, undo, edit).
// Rule: advisory locks are always the first locks of the transaction, never taken after a row
// lock. Writes of expenses take none: they read the category and method FOR SHARE, so an archive
// at the same time waits for them (or they wait for it and see it archived).
import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { planReorder } from "@/modules/core/life-area-order";
import type {
  CatalogKind,
  CategoryItem,
  CreateCategoryInput,
  CreatePaymentMethodInput,
  FinanceCatalog,
  PaymentMethodItem,
  RenameCategoryInput,
  UnarchiveCatalogInput,
  UpdatePaymentMethodInput,
} from "./catalog-input";
import { financeCategories, financePaymentMethods, financeSettings } from "./db/schema";
import { FINANCE_ADVISORY_SPACE, FINANCE_CATEGORIES_KEY, FINANCE_METHODS_KEY } from "./lock-keys";
import { rateFromDb, rateToDb } from "./money";

export { FINANCE_ADVISORY_SPACE, FINANCE_CATEGORIES_KEY, FINANCE_METHODS_KEY } from "./lock-keys";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Tx;

/** Why a catalog write was refused. */
export type CatalogFailure = "notFound" | "archived" | "nameTaken" | "staleOrder";

async function advisoryLock(tx: Tx, key: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(FINANCE_ADVISORY_SPACE))}, hashtext(${key}))`,
  );
}

/** The lock of one list. Must be the first lock of the transaction (see the header). */
export function lockCatalog(tx: Tx, kind: CatalogKind) {
  return advisoryLock(tx, kind === "categories" ? FINANCE_CATEGORIES_KEY : FINANCE_METHODS_KEY);
}

/** F2: one recurring payment's lock. First locks only. */
export function lockRecurring(tx: Tx, id: string) {
  return advisoryLock(tx, id);
}

const CATEGORY = {
  id: financeCategories.id,
  name: financeCategories.name,
  sortOrder: financeCategories.sortOrder,
};

const METHOD = {
  id: financePaymentMethods.id,
  name: financePaymentMethods.name,
  currency: financePaymentMethods.currency,
  sortOrder: financePaymentMethods.sortOrder,
};

const tableOf = (kind: CatalogKind) =>
  kind === "categories" ? financeCategories : financePaymentMethods;

/** The settings row (there is at most one; none until something is saved). */
async function readSettings(db: Reader) {
  const [row] = await db
    .select({
      usdToPen: financeSettings.usdToPen,
      lastPaymentMethodId: financeSettings.lastPaymentMethodId,
    })
    .from(financeSettings)
    .where(eq(financeSettings.id, 1));
  return row ?? { usdToPen: null, lastPaymentMethodId: null };
}

/** The current USD → PEN rate in ten-thousandths, or null when it isn't set. */
export async function selectUsdToPen(db: Reader): Promise<number | null> {
  return rateFromDb((await readSettings(db)).usdToPen);
}

/** The whole catalog in one read (four small queries): the "Ajustes" sheet and the form. */
export async function selectCatalog(db: Reader): Promise<FinanceCatalog> {
  const [categories, methods, archivedCategories, archivedMethods, settings] = await Promise.all([
    db
      .select(CATEGORY)
      .from(financeCategories)
      .where(isNull(financeCategories.archivedAt))
      .orderBy(asc(financeCategories.sortOrder), asc(financeCategories.createdAt)),
    db
      .select(METHOD)
      .from(financePaymentMethods)
      .where(isNull(financePaymentMethods.archivedAt))
      .orderBy(asc(financePaymentMethods.sortOrder), asc(financePaymentMethods.createdAt)),
    db
      .select(CATEGORY)
      .from(financeCategories)
      .where(isNotNull(financeCategories.archivedAt))
      .orderBy(desc(financeCategories.archivedAt), desc(financeCategories.createdAt)),
    db
      .select(METHOD)
      .from(financePaymentMethods)
      .where(isNotNull(financePaymentMethods.archivedAt))
      .orderBy(desc(financePaymentMethods.archivedAt), desc(financePaymentMethods.createdAt)),
    readSettings(db),
  ]);
  return {
    categories,
    methods,
    archivedCategories,
    archivedMethods,
    usdToPenE4: rateFromDb(settings.usdToPen),
    // A method archived since is no default any more.
    lastPaymentMethodId: methods.some((method) => method.id === settings.lastPaymentMethodId)
      ? settings.lastPaymentMethodId
      : null,
  };
}

/** Whether another visible item of the list already has this name (any case). */
async function nameTaken(tx: Tx, kind: CatalogKind, name: string, exceptId?: string) {
  const table = tableOf(kind);
  const conditions: SQL[] = [sql`lower(${table.name}) = lower(${name})`, isNull(table.archivedAt)];
  if (exceptId) conditions.push(ne(table.id, exceptId));
  const [row] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(...conditions))
    .limit(1);
  return row !== undefined;
}

/** The position after every item of the list, archived ones included (like a new area). */
function nextSortOrder(kind: CatalogKind) {
  const table = tableOf(kind);
  return sql<number>`(select coalesce(max(${table.sortOrder}) + 1, 0) from ${table})`;
}

/** A new category at the end of the list. "nameTaken" when a visible one has that name. */
export async function insertCategory(
  db: Database,
  input: CreateCategoryInput,
): Promise<CategoryItem | CatalogFailure> {
  return db.transaction(async (tx) => {
    await lockCatalog(tx, "categories");
    if (await nameTaken(tx, "categories", input.name)) return "nameTaken";
    const [created] = await tx
      .insert(financeCategories)
      .values({ name: input.name, sortOrder: nextSortOrder("categories") })
      .returning(CATEGORY);
    return created;
  });
}

/** A new payment method (with its default currency) at the end of the list. */
export async function insertPaymentMethod(
  db: Database,
  input: CreatePaymentMethodInput,
): Promise<PaymentMethodItem | CatalogFailure> {
  return db.transaction(async (tx) => {
    await lockCatalog(tx, "methods");
    if (await nameTaken(tx, "methods", input.name)) return "nameTaken";
    const [created] = await tx
      .insert(financePaymentMethods)
      .values({ name: input.name, currency: input.currency, sortOrder: nextSortOrder("methods") })
      .returning(METHOD);
    return created;
  });
}

/**
 * Renames a visible category. Its expenses show the new name (they point at it). "archived":
 * reactivate it first.
 */
export async function renameCategory(
  db: Database,
  input: RenameCategoryInput,
): Promise<CategoryItem | CatalogFailure> {
  return db.transaction(async (tx) => {
    await lockCatalog(tx, "categories");
    const [existing] = await tx
      .select({ archivedAt: financeCategories.archivedAt })
      .from(financeCategories)
      .where(eq(financeCategories.id, input.id));
    if (!existing) return "notFound";
    if (existing.archivedAt !== null) return "archived";
    if (await nameTaken(tx, "categories", input.name, input.id)) return "nameTaken";
    const [updated] = await tx
      .update(financeCategories)
      .set({ name: input.name })
      .where(eq(financeCategories.id, input.id))
      .returning(CATEGORY);
    return updated;
  });
}

/**
 * Renames a visible payment method and sets its default currency (only new expenses use it: the
 * saved ones keep their own currency).
 */
export async function updatePaymentMethod(
  db: Database,
  input: UpdatePaymentMethodInput,
): Promise<PaymentMethodItem | CatalogFailure> {
  return db.transaction(async (tx) => {
    await lockCatalog(tx, "methods");
    const [existing] = await tx
      .select({ archivedAt: financePaymentMethods.archivedAt })
      .from(financePaymentMethods)
      .where(eq(financePaymentMethods.id, input.id));
    if (!existing) return "notFound";
    if (existing.archivedAt !== null) return "archived";
    if (await nameTaken(tx, "methods", input.name, input.id)) return "nameTaken";
    const [updated] = await tx
      .update(financePaymentMethods)
      .set({ name: input.name, currency: input.currency })
      .where(eq(financePaymentMethods.id, input.id))
      .returning(METHOD);
    return updated;
  });
}

/**
 * Puts the visible items of a list in the order of `ids`. Archived items keep their slots (so
 * the undo of an archive puts one back in place) and every item gets a position: `sort_order`
 * ends up contiguous (0…n-1). "staleOrder", writing nothing, when `ids` isn't exactly the visible
 * items (a stale list on screen, or a tampered request).
 */
export async function reorderCatalog(
  db: Database,
  kind: CatalogKind,
  ids: readonly string[],
): Promise<true | CatalogFailure> {
  const table = tableOf(kind);
  return db.transaction(async (tx) => {
    await lockCatalog(tx, kind);
    const rows = await tx
      .select({ id: table.id, sortOrder: table.sortOrder, archivedAt: table.archivedAt })
      .from(table)
      .orderBy(asc(table.sortOrder), asc(table.createdAt));
    const plan = planReorder(
      rows.map((row) => ({ id: row.id, archived: row.archivedAt !== null })),
      ids,
    );
    if (!plan) return "staleOrder";
    const current = new Map(rows.map((row) => [row.id, row.sortOrder]));
    const changed = plan
      .map((id, index) => ({ id, index }))
      .filter(({ id, index }) => current.get(id) !== index);
    if (changed.length > 0) {
      const position = sql.join(
        changed.map(({ id, index }) => sql`when ${id}::uuid then ${index}::integer`),
        sql` `,
      );
      await tx
        .update(table)
        .set({ sortOrder: sql`case ${table.id} ${position} end` })
        .where(
          sql`${table.id} in (${sql.join(
            changed.map(({ id }) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        );
    }
    return true;
  });
}

/**
 * Archives an item: out of the form's choices, its expenses untouched. Its place stays. Twice is
 * fine. "notFound" when it doesn't exist.
 */
export async function archiveCatalogItem(
  db: Database,
  kind: CatalogKind,
  id: string,
): Promise<true | CatalogFailure> {
  const table = tableOf(kind);
  return db.transaction(async (tx) => {
    await lockCatalog(tx, kind);
    const [existing] = await tx.select({ id: table.id }).from(table).where(eq(table.id, id));
    if (!existing) return "notFound";
    await tx
      .update(table)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(table.id, id), isNull(table.archivedAt)));
    return true;
  });
}

/**
 * Reactivates an archived item: at the end of its list (`end`) or in its old place (`original`,
 * the undo of an archive). "nameTaken" when a visible item took its name meanwhile (rename one of
 * them first). Twice is fine.
 */
export async function unarchiveCatalogItem(
  db: Database,
  kind: CatalogKind,
  { id, position }: UnarchiveCatalogInput,
): Promise<true | CatalogFailure> {
  const table = tableOf(kind);
  return db.transaction(async (tx) => {
    await lockCatalog(tx, kind);
    const [existing] = await tx
      .select({ name: table.name, archivedAt: table.archivedAt })
      .from(table)
      .where(eq(table.id, id));
    if (!existing) return "notFound";
    if (existing.archivedAt === null) return true;
    if (await nameTaken(tx, kind, existing.name, id)) return "nameTaken";
    await tx
      .update(table)
      .set({
        archivedAt: null,
        ...(position === "end" ? { sortOrder: nextSortOrder(kind) } : {}),
      })
      .where(eq(table.id, id));
    return true;
  });
}

/** Sets (or, with null, clears) the USD → PEN rate. Only new USD expenses use it. */
export async function setUsdToPen(db: Database, rateE4: number | null): Promise<void> {
  const value = rateE4 === null ? null : rateToDb(rateE4);
  await db
    .insert(financeSettings)
    .values({ id: 1, usdToPen: value })
    .onConflictDoUpdate({
      target: financeSettings.id,
      set: { usdToPen: value, updatedAt: sql`now()` },
    });
}

/** Remembers the method of the expense just saved (the next one's default). */
export async function rememberPaymentMethod(tx: Tx, methodId: string): Promise<void> {
  await tx
    .insert(financeSettings)
    .values({ id: 1, lastPaymentMethodId: methodId })
    .onConflictDoUpdate({
      target: financeSettings.id,
      set: { lastPaymentMethodId: methodId, updatedAt: sql`now()` },
    });
}

/** Reads the settings row in a write transaction (the rate a USD expense stores). */
export function readSettingsIn(tx: Tx) {
  return readSettings(tx);
}
