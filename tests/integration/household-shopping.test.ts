// H2 of `household` against the throwaway database: the table's CHECKs and unique index with raw
// inserts, adding a product (reuse instead of duplicate, concurrency under the name's lock), the
// state changes, the exact «Deshacer» of «Quitar», «Olvidar» and «Terminé la compra», authorization
// and the export.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { householdProducts } from "@/modules/household/db/schema";
import { HOUSEHOLD_ADVISORY_SPACE } from "@/modules/household/lock-keys";
import { selectProducts } from "@/modules/household/products";
import {
  addShoppingProduct,
  changeProductQuantity,
  finishShoppingTrip,
  forgetShoppingProduct,
  markProductBought,
  removeProductFromShoppingList,
  undoFinishShoppingTrip,
  undoForgetProduct,
  undoRemoveProduct,
} from "@/modules/household/shopping-actions";
import { getProducts } from "@/modules/household/shopping-queries";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

async function add(input: Record<string, unknown>) {
  const result = await addShoppingProduct(input);
  if (!result.ok) throw new Error(`addShoppingProduct failed: ${JSON.stringify(result)}`);
  return result.data;
}

const rows = () => testDb.select().from(householdProducts).orderBy(householdProducts.name);
const rowOf = async (id: string) =>
  (await testDb.select().from(householdProducts).where(eq(householdProducts.id, id)))[0];

/** The constraint a raw statement breaks (Postgres error code and constraint name), or null. */
async function violation(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
}

const BASE = { name: "Leche", nameKey: "leche" } as const;

describe("the table's own CHECKs and index", () => {
  test("a valid row goes in, with the defaults a list needs", async () => {
    const [row] = await testDb.insert(householdProducts).values(BASE).returning();
    expect(row).toMatchObject({
      category: "otros",
      status: "needed",
      boughtAt: null,
      deletedAt: null,
    });
  });

  test.each([
    ["an empty name", { name: "" }, "household_products_name_check"],
    ["a name of 81 characters", { name: "x".repeat(81) }, "household_products_name_check"],
    ["an empty key", { nameKey: "" }, "household_products_name_check"],
    ["a key with capitals", { nameKey: "Leche" }, "household_products_name_check"],
    ["an unknown category", { category: "ferreteria" }, "household_products_category_check"],
    ["an unknown status", { status: "perdido" }, "household_products_status_check"],
    ["an empty quantity", { quantity: "" }, "household_products_quantity_check"],
    [
      "a quantity of 31 characters",
      { quantity: "x".repeat(31) },
      "household_products_quantity_check",
    ],
    ["bought without a time", { status: "bought" }, "household_products_bought_check"],
    [
      "a time without being bought",
      { status: "needed", boughtAt: new Date() },
      "household_products_bought_check",
    ],
    [
      "an idle one with a time",
      { status: "idle", boughtAt: new Date() },
      "household_products_bought_check",
    ],
  ] as const)("%s is refused", async (_, patch, constraint) => {
    const result = await violation(() =>
      testDb.insert(householdProducts).values({ ...BASE, ...patch }),
    );
    expect(result).toEqual({ code: "23514", constraint });
  });

  test("bought with a time, and a 30-character quantity, are fine (positive controls)", async () => {
    await testDb
      .insert(householdProducts)
      .values({ ...BASE, status: "bought", boughtAt: new Date(), quantity: "x".repeat(30) });
    expect(await rows()).toHaveLength(1);
  });

  test("two live products of one name are refused; a forgotten one frees the name", async () => {
    const [first] = await testDb.insert(householdProducts).values(BASE).returning();
    const second = await violation(() =>
      testDb.insert(householdProducts).values({ ...BASE, name: "LECHE" }),
    );
    expect(second).toEqual({ code: "23505", constraint: "household_products_name_key_unique" });
    await testDb
      .update(householdProducts)
      .set({ deletedAt: new Date() })
      .where(eq(householdProducts.id, first.id));
    await testDb.insert(householdProducts).values(BASE);
    expect(await rows()).toHaveLength(2);
  });
});

describe("adding", () => {
  test("a new name creates a row on the list, «otros» by default, normalized", async () => {
    const result = await add({ name: "  Leche   entera " });
    expect(result).toMatchObject({ created: true, alreadyOnList: false });
    expect(result.product).toMatchObject({
      name: "Leche entera",
      category: "otros",
      status: "needed",
      quantity: null,
    });
    expect((await rows())[0].nameKey).toBe("leche entera");
  });

  test("the same name again (any case or accent) reuses the row instead of duplicating it", async () => {
    await add({ name: "Café", category: "especerias", quantity: "1 bolsa" });
    const again = await add({ name: "  CAFE " });
    expect(again).toMatchObject({ created: false, alreadyOnList: true });
    expect(await rows()).toHaveLength(1);
    // It keeps the category and the quantity it had: a missing field is not «none».
    expect(again.product).toMatchObject({ category: "especerias", quantity: "1 bolsa" });
  });

  test("a known product comes back to the list; a bought one is unchecked; given fields replace", async () => {
    const first = (await add({ name: "Arroz", category: "otros" })).product;
    await markProductBought({ id: first.id, bought: true });
    const back = await add({ name: "arroz", quantity: "2 kg", category: "especerias" });
    expect(back).toMatchObject({ created: false, alreadyOnList: false });
    expect(back.product).toMatchObject({
      status: "needed",
      quantity: "2 kg",
      category: "especerias",
    });
    expect((await rowOf(first.id)).boughtAt).toBeNull();
    // An empty quantity does clear it (the owner emptied the field).
    expect((await add({ name: "arroz", quantity: "" })).product.quantity).toBeNull();
  });

  test("six adds of the same name at once leave one row; different names leave one each", async () => {
    const same = await Promise.all(
      Array.from({ length: 6 }, () => addShoppingProduct({ name: "Pan" })),
    );
    expect(same.every((result) => result.ok)).toBe(true);
    expect(await rows()).toHaveLength(1);
    expect(same.filter((result) => result.ok && result.data.created)).toHaveLength(1);
    await Promise.all(["Sal", "Azúcar", "Té"].map((name) => addShoppingProduct({ name })));
    expect(await rows()).toHaveLength(4);
  });

  test("the add waits for the name's advisory lock (and different names don't)", async () => {
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        HOUSEHOLD_ADVISORY_SPACE,
        "queso",
      ]);
      let settled = false;
      const blocked = addShoppingProduct({ name: "Queso" }).then((result) => {
        settled = true;
        return result;
      });
      // A different name goes through while "queso" is held.
      expect((await addShoppingProduct({ name: "Jamón" })).ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(settled).toBe(false);
      await holder.query("commit");
      expect((await blocked).ok).toBe(true);
    } finally {
      holder.release();
    }
    expect((await rows()).map((row) => row.name).toSorted()).toEqual(["Jamón", "Queso"]);
  });

  test("invalid input is refused before the database", async () => {
    for (const bad of [
      { name: "" },
      { name: "x".repeat(81) },
      { name: "Pan", category: "x" },
      { name: "Pan", quantity: "x".repeat(31) },
    ]) {
      expect((await addShoppingProduct(bad)).ok).toBe(false);
    }
    expect(await rows()).toHaveLength(0);
  });

  test("it revalidates the household", async () => {
    await add({ name: "Pan" });
    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).toContain("/household");
  });
});

describe("«Comprado» and the quantity", () => {
  test("checks it off with a time; again keeps the first time; unchecking clears it", async () => {
    const { product } = await add({ name: "Pan" });
    const first = await markProductBought({ id: product.id, bought: true });
    expect(first).toMatchObject({ ok: true, data: { status: "bought" } });
    const at = (await rowOf(product.id)).boughtAt;
    expect(at).not.toBeNull();
    await markProductBought({ id: product.id, bought: true });
    expect((await rowOf(product.id)).boughtAt).toEqual(at);
    await markProductBought({ id: product.id, bought: false });
    expect(await rowOf(product.id)).toMatchObject({ status: "needed", boughtAt: null });
  });

  test("a product that is only known (idle), forgotten or missing can't be checked", async () => {
    const { product } = await add({ name: "Pan" });
    await removeProductFromShoppingList({ id: product.id });
    expect((await markProductBought({ id: product.id, bought: true })).ok).toBe(false);
    expect((await rowOf(product.id)).status).toBe("idle");
    expect(
      (await markProductBought({ id: "00000000-0000-4000-8000-0000000000ff", bought: true })).ok,
    ).toBe(false);
  });

  test("the quantity is set and cleared", async () => {
    const { product } = await add({ name: "Pan" });
    expect(await changeProductQuantity({ id: product.id, quantity: " 2  kg " })).toMatchObject({
      ok: true,
      data: { quantity: "2 kg" },
    });
    expect(await changeProductQuantity({ id: product.id, quantity: "" })).toMatchObject({
      ok: true,
      data: { quantity: null },
    });
    expect((await changeProductQuantity({ id: product.id })).ok).toBe(false);
  });
});

describe("«Quitar» and its «Deshacer»", () => {
  test("a needed product goes to known and comes back exactly", async () => {
    const { product } = await add({ name: "Pan" });
    const removed = await removeProductFromShoppingList({ id: product.id });
    if (!removed.ok) throw new Error("not removed");
    expect(removed.data).toMatchObject({ previousStatus: "needed", previousBoughtAt: null });
    expect((await rowOf(product.id)).status).toBe("idle");
    const back = await undoRemoveProduct({
      id: product.id,
      previousStatus: "needed",
      boughtAt: null,
    });
    expect(back).toMatchObject({ ok: true, data: { status: "needed" } });
  });

  test("a bought product comes back bought, with the time it had", async () => {
    const { product } = await add({ name: "Pan" });
    await markProductBought({ id: product.id, bought: true });
    const at = (await rowOf(product.id)).boughtAt!;
    const removed = await removeProductFromShoppingList({ id: product.id });
    if (!removed.ok) throw new Error("not removed");
    expect(removed.data.previousBoughtAt).toBe(at.toISOString());
    await undoRemoveProduct({
      id: product.id,
      previousStatus: "bought",
      boughtAt: removed.data.previousBoughtAt,
    });
    expect(await rowOf(product.id)).toMatchObject({ status: "bought", boughtAt: at });
  });

  test("one put back on the list by hand meanwhile is not overwritten, and removing twice fails", async () => {
    const { product } = await add({ name: "Pan" });
    await removeProductFromShoppingList({ id: product.id });
    expect((await removeProductFromShoppingList({ id: product.id })).ok).toBe(false);
    await add({ name: "Pan", quantity: "3" });
    const result = await undoRemoveProduct({
      id: product.id,
      previousStatus: "needed",
      boughtAt: null,
    });
    expect(result.ok).toBe(false);
    expect(await rowOf(product.id)).toMatchObject({ status: "needed", quantity: "3" });
  });
});

describe("«Olvidar» and its «Deshacer»", () => {
  test("it leaves every list (and stays in the table), the name is free, and it can come back", async () => {
    const { product } = await add({ name: "Pan" });
    const forgot = await forgetShoppingProduct({ id: product.id });
    expect(forgot.ok).toBe(true);
    expect((await rowOf(product.id)).deletedAt).not.toBeNull();
    expect(await selectProducts(testDb)).toEqual([]);
    expect((await forgetShoppingProduct({ id: product.id })).ok).toBe(false);
    const back = await undoForgetProduct({ id: product.id });
    expect(back).toMatchObject({ ok: true, data: { status: "idle" } });
    // Restoring one that is not deleted changes nothing.
    expect((await undoForgetProduct({ id: product.id })).ok).toBe(true);
    expect(await selectProducts(testDb)).toHaveLength(1);
  });

  test("if the name was taken meanwhile it stays forgotten, and says so", async () => {
    const { product } = await add({ name: "Pan" });
    await forgetShoppingProduct({ id: product.id });
    const newer = (await add({ name: "Pan" })).product;
    expect(newer.id).not.toBe(product.id);
    const back = await undoForgetProduct({ id: product.id });
    expect(back).toMatchObject({ ok: false, error: expect.stringContaining("otro producto") });
    expect((await rowOf(product.id)).deletedAt).not.toBeNull();
    expect(await selectProducts(testDb)).toHaveLength(1);
  });
});

describe("«Terminé la compra»", () => {
  async function bought(...names: string[]) {
    const ids: string[] = [];
    for (const name of names) {
      const { product } = await add({ name });
      await markProductBought({ id: product.id, bought: true });
      ids.push(product.id);
    }
    return ids;
  }

  test("every bought product becomes known in one step, with what the undo needs; the list is untouched", async () => {
    const [a, b] = await bought("Pan", "Sal");
    const { product: onList } = await add({ name: "Té" });
    const result = await finishShoppingTrip({});
    if (!result.ok) throw new Error("not finished");
    expect(result.data.entries.map((entry) => entry.id).toSorted()).toEqual([a, b].toSorted());
    expect(await rowOf(a)).toMatchObject({ status: "idle", boughtAt: null });
    expect((await rowOf(onList.id)).status).toBe("needed");
  });

  test("with nothing bought it does nothing", async () => {
    await add({ name: "Té" });
    expect(await finishShoppingTrip({})).toEqual({ ok: true, data: { entries: [] } });
  });

  test("the undo puts back each product with its time, only the ones still known", async () => {
    const [a, b, c] = await bought("Pan", "Sal", "Té");
    const times = new Map<string, Date>();
    for (const id of [a, b, c]) times.set(id, (await rowOf(id)).boughtAt!);
    const finished = await finishShoppingTrip({});
    if (!finished.ok) throw new Error("not finished");
    // Meanwhile: «Sal» went back on the list by hand, «Té» was forgotten.
    await add({ name: "Sal" });
    await forgetShoppingProduct({ id: c });
    const undone = await undoFinishShoppingTrip({ entries: finished.data.entries });
    if (!undone.ok) throw new Error("not undone");
    expect(undone.data.restored).toEqual([a]);
    expect(undone.data.kept.toSorted()).toEqual([b, c].toSorted());
    expect(await rowOf(a)).toMatchObject({ status: "bought", boughtAt: times.get(a) });
    expect((await rowOf(b)).status).toBe("needed");
    expect((await rowOf(c)).deletedAt).not.toBeNull();
  });

  test("the undo refuses a repeated id, a bad time and more than 500 products", async () => {
    const entry = {
      id: "00000000-0000-4000-8000-000000000001",
      boughtAt: "2026-10-14T15:00:00.000Z",
    };
    expect((await undoFinishShoppingTrip({ entries: [entry, entry] })).ok).toBe(false);
    expect((await undoFinishShoppingTrip({ entries: [{ ...entry, boughtAt: "ayer" }] })).ok).toBe(
      false,
    );
    const many = Array.from({ length: 501 }, (_, n) => ({
      ...entry,
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    }));
    expect((await undoFinishShoppingTrip({ entries: many })).ok).toBe(false);
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    [
      "a forged cookie",
      async () => new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the read redirects to /login and every write is refused", async (_, headers) => {
    const { product } = await add({ name: "Del owner" });
    // Positive control: the owner reads.
    expect(await getProducts()).toHaveLength(1);

    request.headers = await headers();
    await expect(getProducts()).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    const id = { id: product.id };
    expect(await addShoppingProduct({ name: "Intruso" })).toEqual(refused);
    expect(await markProductBought({ ...id, bought: true })).toEqual(refused);
    expect(await changeProductQuantity({ ...id, quantity: "9" })).toEqual(refused);
    expect(await removeProductFromShoppingList(id)).toEqual(refused);
    expect(await undoRemoveProduct({ ...id, previousStatus: "needed", boughtAt: null })).toEqual(
      refused,
    );
    expect(await forgetShoppingProduct(id)).toEqual(refused);
    expect(await undoForgetProduct(id)).toEqual(refused);
    expect(await finishShoppingTrip({})).toEqual(refused);
    expect(await undoFinishShoppingTrip({ entries: [] })).toEqual(refused);
    expect((await rows()).map((row) => [row.name, row.status])).toEqual([["Del owner", "needed"]]);
  });
});

describe("export", () => {
  test("every product is exported, forgotten ones and idle ones included", async () => {
    const a = (await add({ name: "Pan", category: "otros", quantity: "2" })).product;
    const b = (await add({ name: "Sal" })).product;
    await markProductBought({ id: b.id, bought: true });
    const c = (await add({ name: "Té" })).product;
    await forgetShoppingProduct({ id: c.id });
    await removeProductFromShoppingList({ id: a.id });

    const data = await buildExport(testDb, new Date("2026-10-14T15:00:00Z"));
    const table = data.tables.household_products;
    expect(table.rowCount).toBe(3);
    expect(
      table.rows.map((row) => [row.name, row.status, row.deleted_at !== null]).toSorted(),
    ).toEqual(
      [
        ["Pan", "idle", false],
        ["Sal", "bought", false],
        ["Té", "idle", true],
      ].toSorted(),
    );
    expect(table.rows.find((row) => row.name === "Pan")).toMatchObject({
      category: "otros",
      quantity: "2",
      name_key: "pan",
    });
  });
});
