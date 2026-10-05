// F1 of `finance` against the throwaway database: the catalog (categories and methods with their
// lock, contiguous order and unique names; the USD → PEN rate), expenses (defaults, the rate
// stored per expense, edit, soft delete and undo), the reads, the export and authorization.
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { ownerDateKey } from "@/lib/time";
import {
  createExpense,
  deleteExpense,
  editExpense,
  restoreExpense,
} from "@/modules/finance/actions";
import {
  FINANCE_ADVISORY_SPACE,
  FINANCE_CATEGORIES_KEY,
  FINANCE_METHODS_KEY,
} from "@/modules/finance/catalog";
import {
  archiveCategory,
  archivePaymentMethod,
  createCategory,
  createPaymentMethod,
  readFinanceCatalog,
  renameCategory,
  reorderCategories,
  reorderPaymentMethods,
  setExchangeRate,
  unarchiveCategory,
  unarchivePaymentMethod,
  updatePaymentMethod,
} from "@/modules/finance/catalog-actions";
import type { FinanceCatalog } from "@/modules/finance/catalog-input";
import {
  financeCategories,
  financeExpenses,
  financePaymentMethods,
  financeSettings,
} from "@/modules/finance/db/schema";
import type { ExpenseItem } from "@/modules/finance/expense-input";
import { CATALOG_ERRORS, EXPENSE_ERRORS } from "@/modules/finance/finance-copy";
import { getFinanceCatalog, listMonthExpenses } from "@/modules/finance/queries";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

// The actions read the request headers (session cookie) and the app database: point both at
// the test, and record revalidations instead of touching Next's cache.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };
const MISSING = "00000000-0000-4000-8000-000000000000";
/** The actions use Lima's today by the real clock: so do the tests. */
const today = () => ownerDateKey(new Date());

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

/** Runs a catalog action and returns the catalog (fails the test otherwise). */
async function catalogAfter(result: Promise<{ ok: boolean; data?: FinanceCatalog }>) {
  const settled = await result;
  if (!settled.ok || !settled.data)
    throw new Error(`Catalog action failed: ${JSON.stringify(settled)}`);
  return settled.data;
}

async function newCategory(name: string) {
  const catalog = await catalogAfter(createCategory({ name }));
  return catalog.categories.find((item) => item.name === name.trim())!;
}

async function newMethod(name: string, currency: "PEN" | "USD" = "PEN") {
  const catalog = await catalogAfter(createPaymentMethod({ name, currency }));
  return catalog.methods.find((item) => item.name === name)!;
}

async function expense(input: Record<string, unknown>): Promise<ExpenseItem> {
  const result = await createExpense(input);
  if (!result.ok) throw new Error(`createExpense failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function stored(id: string) {
  const [row] = await testDb.select().from(financeExpenses).where(eq(financeExpenses.id, id));
  return row;
}

async function orders(table: typeof financeCategories | typeof financePaymentMethods) {
  return testDb
    .select({ name: table.name, sortOrder: table.sortOrder, archived: table.archivedAt })
    .from(table)
    .orderBy(asc(table.sortOrder));
}

describe("catalog", () => {
  test("categories: created at the end, renamed, reordered contiguously, archived and back", async () => {
    const comida = await newCategory("  Comida ");
    const casa = await newCategory("Casa");
    const salud = await newCategory("Salud");
    expect(comida).toMatchObject({ name: "Comida", sortOrder: 0 });
    expect(revalidatePath).toHaveBeenCalledWith("/finance", "layout");

    let catalog = await catalogAfter(renameCategory({ id: casa.id, name: "Hogar" }));
    expect(catalog.categories.map((item) => item.name)).toEqual(["Comida", "Hogar", "Salud"]);

    catalog = await catalogAfter(reorderCategories({ ids: [salud.id, comida.id, casa.id] }));
    expect(catalog.categories.map((item) => item.name)).toEqual(["Salud", "Comida", "Hogar"]);

    // Archived: out of the list, its slot kept (the order stays contiguous).
    catalog = await catalogAfter(archiveCategory({ id: comida.id }));
    expect(catalog.categories.map((item) => item.name)).toEqual(["Salud", "Hogar"]);
    expect(catalog.archivedCategories.map((item) => item.name)).toEqual(["Comida"]);
    // Reordering the visible ones keeps the archived slot: still contiguous 0…n-1.
    catalog = await catalogAfter(reorderCategories({ ids: [casa.id, salud.id] }));
    expect((await orders(financeCategories)).map((row) => [row.name, row.sortOrder])).toEqual([
      ["Hogar", 0],
      ["Comida", 1],
      ["Salud", 2],
    ]);
    // "Reactivar" puts it at the end (an old "position" field is ignored: there is no undo).
    catalog = await catalogAfter(unarchiveCategory({ id: comida.id, position: "original" }));
    expect(catalog.categories.map((item) => item.name)).toEqual(["Hogar", "Salud", "Comida"]);
    await catalogAfter(archiveCategory({ id: casa.id }));
    catalog = await catalogAfter(unarchiveCategory({ id: casa.id }));
    expect(catalog.categories.map((item) => item.name)).toEqual(["Salud", "Comida", "Hogar"]);
    // Twice is fine.
    expect((await archiveCategory({ id: salud.id })).ok).toBe(true);
    expect((await archiveCategory({ id: salud.id })).ok).toBe(true);
    expect((await unarchiveCategory({ id: comida.id })).ok).toBe(true);
  });

  test("names are unique among the visible ones, in any case", async () => {
    const comida = await newCategory("Comida");
    const taken = {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { name: [CATALOG_ERRORS.categoryTaken] },
    };
    expect(await createCategory({ name: "COMIDA" })).toEqual(taken);
    const otra = await newCategory("Otra");
    expect(await renameCategory({ id: otra.id, name: "comida" })).toEqual(taken);
    // Renaming to its own name in another case is fine.
    expect((await renameCategory({ id: comida.id, name: "COMIDA" })).ok).toBe(true);
    // Archived, its name is free; reactivating it while taken is refused.
    await catalogAfter(archiveCategory({ id: comida.id }));
    expect((await createCategory({ name: "Comida" })).ok).toBe(true);
    expect(await unarchiveCategory({ id: comida.id })).toEqual(taken);
    // Methods have their own message.
    await newMethod("Efectivo");
    expect(await createPaymentMethod({ name: "efectivo", currency: "PEN" })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { name: [CATALOG_ERRORS.methodTaken] },
    });
  });

  test("methods: a default currency that can change; an archived one can't be edited", async () => {
    const debito = await newMethod("Débito dólares", "USD");
    expect(debito.currency).toBe("USD");
    const efectivo = await newMethod("Efectivo");
    let catalog = await catalogAfter(
      updatePaymentMethod({ id: efectivo.id, name: "Efectivo soles", currency: "PEN" }),
    );
    expect(catalog.methods.map((item) => [item.name, item.currency])).toEqual([
      ["Débito dólares", "USD"],
      ["Efectivo soles", "PEN"],
    ]);
    catalog = await catalogAfter(reorderPaymentMethods({ ids: [efectivo.id, debito.id] }));
    expect(catalog.methods.map((item) => item.name)).toEqual(["Efectivo soles", "Débito dólares"]);
    await catalogAfter(archivePaymentMethod({ id: debito.id }));
    expect(await updatePaymentMethod({ id: debito.id, name: "Otro", currency: "USD" })).toEqual({
      ok: false,
      error: CATALOG_ERRORS.archived,
    });
    expect((await unarchivePaymentMethod({ id: debito.id })).ok).toBe(true);
    expect(await renameCategory({ id: MISSING, name: "x" })).toEqual({
      ok: false,
      error: CATALOG_ERRORS.notFound,
    });
    expect(await archivePaymentMethod({ id: MISSING })).toEqual({
      ok: false,
      error: CATALOG_ERRORS.notFound,
    });
  });

  test("a stale or tampered order is refused, writing nothing", async () => {
    const a = await newCategory("A");
    const b = await newCategory("B");
    await catalogAfter(archiveCategory({ id: b.id }));
    const before = await orders(financeCategories);
    for (const ids of [[a.id, b.id], [MISSING], [a.id, MISSING]]) {
      expect(await reorderCategories({ ids })).toEqual({
        ok: false,
        error: CATALOG_ERRORS.staleOrder,
      });
    }
    expect(await orders(financeCategories)).toEqual(before);
  });

  test("the rate: set, changed and cleared (stored with 4 decimals)", async () => {
    expect((await catalogAfter(readFinanceCatalog({}))).usdToPenE4).toBeNull();
    let catalog = await catalogAfter(setExchangeRate({ rate: "3,75" }));
    expect(catalog.usdToPenE4).toBe(37_500);
    const [row] = await testDb.select().from(financeSettings);
    expect(row).toMatchObject({ id: 1, usdToPen: "3.7500" });
    catalog = await catalogAfter(setExchangeRate({ rate: "3.8012" }));
    expect(catalog.usdToPenE4).toBe(38_012);
    catalog = await catalogAfter(setExchangeRate({ rate: "" }));
    expect(catalog.usdToPenE4).toBeNull();
    expect(await setExchangeRate({ rate: "12" })).toMatchObject({ ok: false });
    expect(await testDb.$count(financeSettings)).toBe(1);
  });

  test("create and archive wait for their list's lock; the other list's lock doesn't stop them", async () => {
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        FINANCE_ADVISORY_SPACE,
        FINANCE_CATEGORIES_KEY,
      ]);
      // Positive control: the methods' lock is free, so a method goes through.
      expect((await createPaymentMethod({ name: "Yape", currency: "PEN" })).ok).toBe(true);
      const creating = createCategory({ name: "Comida" });
      const archiving = archiveCategory({ id: MISSING });
      await waitForLockWaiters(FINANCE_CATEGORIES_KEY, 2);
      expect(await testDb.$count(financeCategories)).toBe(0);
      await holder.query("commit");
      expect((await creating).ok).toBe(true);
      expect((await archiving).ok).toBe(false);
    } finally {
      holder.release();
    }
    expect(await testDb.$count(financeCategories)).toBe(1);
  });

  test.each([
    ["categories", FINANCE_CATEGORIES_KEY],
    ["methods", FINANCE_METHODS_KEY],
  ] as const)(
    "%s: rename, reorder and reactivate wait for the list's lock too",
    async (kind, key) => {
      const isCategories = kind === "categories";
      const a = isCategories ? await newCategory("A") : await newMethod("A");
      const b = isCategories ? await newCategory("B") : await newMethod("B");
      const c = isCategories ? await newCategory("C") : await newMethod("C");
      await catalogAfter(
        isCategories ? archiveCategory({ id: c.id }) : archivePaymentMethod({ id: c.id }),
      );
      const holder = await testDb.$client.connect();
      try {
        await holder.query("begin");
        await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
          FINANCE_ADVISORY_SPACE,
          key,
        ]);
        const pending = isCategories
          ? [
              renameCategory({ id: a.id, name: "A2" }),
              reorderCategories({ ids: [b.id, a.id] }),
              unarchiveCategory({ id: c.id }),
            ]
          : [
              updatePaymentMethod({ id: a.id, name: "A2", currency: "USD" }),
              reorderPaymentMethods({ ids: [b.id, a.id] }),
              unarchivePaymentMethod({ id: c.id }),
            ];
        await waitForLockWaiters(key, 3);
        const table = isCategories ? financeCategories : financePaymentMethods;
        expect((await orders(table)).map((row) => row.name)).toEqual(["A", "B", "C"]);
        await holder.query("commit");
        const [renamed, reordered, reactivated] = await Promise.all(pending);
        expect(renamed.ok).toBe(true);
        expect(reactivated.ok).toBe(true);
        // The waiters run in any order: after the reactivation the reorder's list is stale.
        expect(reordered).toSatisfy(
          (result: { ok: boolean; error?: string }) =>
            result.ok || result.error === CATALOG_ERRORS.staleOrder,
        );
      } finally {
        holder.release();
      }
    },
  );

  test("three creates at the same time get positions 0, 1 and 2 (never the same)", async () => {
    await Promise.all([newMethod("A"), newMethod("B"), newMethod("C")]);
    const rows = await orders(financePaymentMethods);
    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2]);
    // The methods' key is its own (documented next to the lock).
    expect(FINANCE_METHODS_KEY).toBe("finance:methods");
  });
});

describe("expenses", () => {
  test("the amount alone: today, no category, no method, PEN", async () => {
    const created = await expense({ amount: "12,50" });
    expect(created).toEqual({
      id: expect.any(String),
      description: null,
      amountCents: 1250,
      currency: "PEN",
      exchangeRateE4: null,
      spentOn: today(),
      category: null,
      paymentMethod: null,
      recurringPaymentId: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/finance", "layout");
  });

  test("the last method used is the next default, with its currency; null means none", async () => {
    const debito = await newMethod("Débito dólares", "USD");
    await catalogAfter(setExchangeRate({ rate: "3.75" }));
    const first = await expense({ amount: "95", paymentMethodId: debito.id });
    // The method's currency, and the rate of the settings stored on the expense.
    expect(first).toMatchObject({
      currency: "USD",
      exchangeRateE4: 37_500,
      paymentMethod: { id: debito.id },
    });
    expect((await stored(first.id)).exchangeRate).toBe("3.7500");
    expect((await catalogAfter(readFinanceCatalog({}))).lastPaymentMethodId).toBe(debito.id);

    // Left out: the last method and its currency.
    const second = await expense({ amount: "10" });
    expect(second).toMatchObject({ currency: "USD", paymentMethod: { id: debito.id } });
    // Sent as null: none, in PEN.
    const third = await expense({ amount: "10", paymentMethodId: null });
    expect(third).toMatchObject({ currency: "PEN", paymentMethod: null, exchangeRateE4: null });
    // An explicit currency wins over the method's.
    expect(await expense({ amount: "10", currency: "PEN" })).toMatchObject({
      currency: "PEN",
      paymentMethod: { id: debito.id },
      exchangeRateE4: null,
    });
    // The default is skipped quietly once the method is archived.
    await catalogAfter(archivePaymentMethod({ id: debito.id }));
    expect(await expense({ amount: "10" })).toMatchObject({ paymentMethod: null, currency: "PEN" });
  });

  test("USD without a rate is stored unconverted; changing the rate never rewrites the past", async () => {
    const unconverted = await expense({ amount: "20", currency: "USD" });
    expect(unconverted.exchangeRateE4).toBeNull();
    await catalogAfter(setExchangeRate({ rate: "3.70" }));
    const before = await expense({ amount: "20", currency: "USD" });
    await catalogAfter(setExchangeRate({ rate: "3.90" }));
    const after = await expense({ amount: "20", currency: "USD" });
    expect([unconverted, before, after].map((item) => item.exchangeRateE4)).toEqual([
      null,
      37_000,
      39_000,
    ]);
    expect((await stored(before.id)).exchangeRate).toBe("3.7000");
  });

  test("category and method must be visible; refusals go on their field", async () => {
    const comida = await newCategory("Comida");
    const efectivo = await newMethod("Efectivo");
    await catalogAfter(archiveCategory({ id: comida.id }));
    await catalogAfter(archivePaymentMethod({ id: efectivo.id }));
    for (const [input, field, message] of [
      [{ categoryId: comida.id }, "categoryId", EXPENSE_ERRORS.categoryUnavailable],
      [{ categoryId: MISSING }, "categoryId", EXPENSE_ERRORS.categoryUnavailable],
      [{ paymentMethodId: efectivo.id }, "paymentMethodId", EXPENSE_ERRORS.methodUnavailable],
      [{ paymentMethodId: MISSING }, "paymentMethodId", EXPENSE_ERRORS.methodUnavailable],
    ] as const) {
      expect(await createExpense({ amount: "1", ...input })).toEqual({
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { [field]: [message] },
      });
    }
    expect(await createExpense({ amount: "0" })).toMatchObject({
      ok: false,
      fieldErrors: { amount: [EXPENSE_ERRORS.amount.tooSmall] },
    });
    expect(await testDb.$count(financeExpenses)).toBe(0);
  });

  test("edit: the whole form; archived refs it already had stay; the rate follows currency and amount", async () => {
    const comida = await newCategory("Comida");
    const debito = await newMethod("Débito dólares", "USD");
    await catalogAfter(setExchangeRate({ rate: "3.70" }));
    const created = await expense({
      amount: "95",
      description: "Claude",
      categoryId: comida.id,
      paymentMethodId: debito.id,
    });
    expect(created.exchangeRateE4).toBe(37_000);
    await catalogAfter(setExchangeRate({ rate: "3.90" }));
    await catalogAfter(archiveCategory({ id: comida.id }));

    const base = {
      id: created.id,
      amount: "95",
      description: "Claude Pro",
      currency: "USD",
      categoryId: comida.id,
      paymentMethodId: debito.id,
      spentOn: "2026-10-01",
    };
    // Same currency and amount: the stored rate stays (and the archived category too).
    let edited = await editExpense(base);
    expect(edited).toMatchObject({
      ok: true,
      data: {
        description: "Claude Pro",
        exchangeRateE4: 37_000,
        category: { id: comida.id },
        spentOn: "2026-10-01",
      },
    });
    // A new amount: today's rate.
    edited = await editExpense({ ...base, amount: "100" });
    expect(edited).toMatchObject({
      ok: true,
      data: { amountCents: 10_000, exchangeRateE4: 39_000 },
    });
    // To PEN: no rate; back to USD: today's rate again.
    edited = await editExpense({ ...base, amount: "100", currency: "PEN" });
    expect(edited).toMatchObject({ ok: true, data: { currency: "PEN", exchangeRateE4: null } });
    await catalogAfter(setExchangeRate({ rate: "" }));
    edited = await editExpense({ ...base, amount: "100", currency: "USD" });
    expect(edited).toMatchObject({ ok: true, data: { currency: "USD", exchangeRateE4: null } });

    // A newly archived category can't be picked; removing it is fine.
    const otra = await newCategory("Otra");
    await catalogAfter(archiveCategory({ id: otra.id }));
    expect(await editExpense({ ...base, categoryId: otra.id })).toMatchObject({
      ok: false,
      fieldErrors: { categoryId: [EXPENSE_ERRORS.categoryUnavailable] },
    });
    expect(await editExpense({ ...base, categoryId: null, description: "" })).toMatchObject({
      ok: true,
      data: { category: null, description: null },
    });
    expect(await editExpense({ ...base, id: MISSING })).toEqual({
      ok: false,
      error: EXPENSE_ERRORS.notFound,
    });
  });

  test("a USD expense saved without a rate adopts the current one on edit; a stored rate is never dropped", async () => {
    const created = await expense({ amount: "20", currency: "USD" });
    expect(created.exchangeRateE4).toBeNull();
    const base = {
      id: created.id,
      amount: "20",
      description: null,
      currency: "USD",
      categoryId: null,
      paymentMethodId: null,
      spentOn: today(),
    };
    // Still no rate: nothing to adopt.
    expect(await editExpense(base)).toMatchObject({ ok: true, data: { exchangeRateE4: null } });
    await catalogAfter(setExchangeRate({ rate: "3.80" }));
    expect(await editExpense(base)).toMatchObject({ ok: true, data: { exchangeRateE4: 38_000 } });
    // The rate is cleared in Ajustes: a new amount keeps the stored one.
    await catalogAfter(setExchangeRate({ rate: "" }));
    expect(await editExpense({ ...base, amount: "25" })).toMatchObject({
      ok: true,
      data: { amountCents: 2_500, exchangeRateE4: 38_000 },
    });
  });

  test("two deletes at the same time: one wins, the other changes nothing (one Deshacer)", async () => {
    const created = await expense({ amount: "9" });
    const results = await Promise.all([
      deleteExpense({ id: created.id }),
      deleteExpense({ id: created.id }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: EXPENSE_ERRORS.notFound },
    ]);
    const deletedAt = (await stored(created.id)).deletedAt;
    // A later delete doesn't move the deletion time either.
    expect(await deleteExpense({ id: created.id })).toMatchObject({ ok: false });
    expect((await stored(created.id)).deletedAt).toEqual(deletedAt);
  });

  test("delete is logical and undone with restore; deleted ones are out of the month", async () => {
    const kept = await expense({ amount: "5", description: "Pan" });
    const gone = await expense({ amount: "7", description: "Café" });
    expect(await deleteExpense({ id: gone.id })).toEqual({ ok: true, data: gone });
    expect((await stored(gone.id)).deletedAt).not.toBeNull();
    const month = today().slice(0, 7);
    expect((await listMonthExpenses(month)).map((item) => item.id)).toEqual([kept.id]);
    // Twice: it isn't there any more.
    expect(await deleteExpense({ id: gone.id })).toEqual({
      ok: false,
      error: EXPENSE_ERRORS.notFound,
    });
    expect(
      await editExpense({
        id: gone.id,
        amount: "1",
        description: null,
        currency: "PEN",
        categoryId: null,
        paymentMethodId: null,
        spentOn: today(),
      }),
    ).toEqual({
      ok: false,
      error: EXPENSE_ERRORS.notFound,
    });

    expect(await restoreExpense({ id: gone.id })).toEqual({ ok: true, data: gone });
    expect(await restoreExpense({ id: gone.id })).toEqual({ ok: true, data: gone });
    expect((await listMonthExpenses(month)).map((item) => item.id)).toEqual([gone.id, kept.id]);
    expect(await restoreExpense({ id: MISSING })).toEqual({
      ok: false,
      error: EXPENSE_ERRORS.notFound,
    });
  });

  test("the month: its own days only, the most recent day first, then the last saved", async () => {
    const a = await expense({ amount: "1", spentOn: "2026-09-30" });
    const b = await expense({ amount: "2", spentOn: "2026-09-01" });
    const c = await expense({ amount: "3", spentOn: "2026-09-30" });
    await expense({ amount: "4", spentOn: "2026-08-31" });
    expect((await listMonthExpenses("2026-09")).map((item) => item.id)).toEqual([c.id, a.id, b.id]);
    expect(await listMonthExpenses("2026-07")).toEqual([]);
    // December rolls into the next year.
    const december = await expense({ amount: "5", spentOn: "2025-12-31" });
    await expense({ amount: "6", spentOn: "2026-01-01" });
    expect((await listMonthExpenses("2025-12")).map((item) => item.id)).toEqual([december.id]);
  });

  test("an archive at the same time: the create holding the category FOR SHARE makes it wait", async () => {
    const comida = await newCategory("Comida");
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("update finance_categories set archived_at = now() where id = $1", [
        comida.id,
      ]);
      const pending = createExpense({ amount: "1", categoryId: comida.id });
      await waitForBlockedBackends(1);
      await holder.query("commit");
      expect(await pending).toMatchObject({
        ok: false,
        fieldErrors: { categoryId: [EXPENSE_ERRORS.categoryUnavailable] },
      });
    } finally {
      holder.release();
    }
    expect(await testDb.$count(financeExpenses)).toBe(0);
  });
});

describe("export", () => {
  test("every finance table, with archived and deleted rows", async () => {
    const comida = await newCategory("Comida");
    await catalogAfter(archiveCategory({ id: comida.id }));
    await newMethod("Efectivo");
    await catalogAfter(setExchangeRate({ rate: "3.75" }));
    const gone = await expense({ amount: "5", currency: "USD" });
    await deleteExpense({ id: gone.id });
    const data = await buildExport(testDb, new Date());
    expect(data.tables.finance_categories.rows).toEqual([
      expect.objectContaining({ name: "Comida", archived_at: expect.any(Date) }),
    ]);
    expect(data.tables.finance_payment_methods.rowCount).toBe(1);
    expect(data.tables.finance_expenses.rows).toEqual([
      expect.objectContaining({
        amount_cents: 500,
        exchange_rate: "3.7500",
        deleted_at: expect.any(Date),
      }),
    ]);
    expect(data.tables.finance_settings.rows).toEqual([
      expect.objectContaining({ id: 1, usd_to_pen: "3.7500" }),
    ]);
    expect(data.tables.finance_recurring_payments).toEqual({ rowCount: 0, rows: [] });
    expect(data.tables.finance_settlements).toEqual({ rowCount: 0, rows: [] });
  });
});

/** Waits until `count` backends of this database are blocked on a lock (any kind). */
async function waitForBlockedBackends(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await testDb.$client.query<{ blocked: number }>(
      `select count(*)::int as blocked from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (result.rows[0].blocked >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} blocked backends`);
}

/** Waits until `count` connections wait on the finance advisory lock with this key. */
async function waitForLockWaiters(key: string, count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await testDb.$client.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_locks
       where locktype = 'advisory' and not granted and objsubid = 2
         and classid::bigint = $1::bigint
         and objid::bigint = (hashtext($2)::bigint & 4294967295)`,
      [FINANCE_ADVISORY_SPACE, key],
    );
    if (result.rows[0].waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} lock waiters`);
}

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    [
      "a forged cookie",
      async () => new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s every action is refused and nothing changes", async (_, headers) => {
    const comida = await newCategory("Comida");
    const created = await expense({ amount: "5" });
    request.headers = await headers();
    for (const call of [
      () => createExpense({ amount: "1" }),
      () =>
        editExpense({
          id: created.id,
          amount: "1",
          description: null,
          currency: "PEN",
          categoryId: null,
          paymentMethodId: null,
          spentOn: today(),
        }),
      () => deleteExpense({ id: created.id }),
      () => restoreExpense({ id: created.id }),
      () => readFinanceCatalog({}),
      () => createCategory({ name: "Otra" }),
      () => renameCategory({ id: comida.id, name: "X" }),
      () => reorderCategories({ ids: [comida.id] }),
      () => archiveCategory({ id: comida.id }),
      () => unarchiveCategory({ id: comida.id }),
      () => createPaymentMethod({ name: "Yape", currency: "PEN" }),
      () => updatePaymentMethod({ id: MISSING, name: "X", currency: "PEN" }),
      () => reorderPaymentMethods({ ids: [MISSING] }),
      () => archivePaymentMethod({ id: MISSING }),
      () => unarchivePaymentMethod({ id: MISSING }),
      () => setExchangeRate({ rate: "3.75" }),
    ]) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await testDb.$count(financeExpenses)).toBe(1);
    expect(await testDb.$count(financeCategories)).toBe(1);
    expect(await testDb.$count(financePaymentMethods)).toBe(0);
    expect(await testDb.$count(financeSettings)).toBe(0);
    expect((await stored(created.id)).deletedAt).toBeNull();
    // Positive control: the owner's session still works.
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
    expect((await createExpense({ amount: "1" })).ok).toBe(true);
  });

  test("the reads redirect to /login without a session", async () => {
    request.headers = new Headers();
    for (const read of [() => getFinanceCatalog(), () => listMonthExpenses("2026-10")]) {
      await expect(read()).rejects.toMatchObject({
        digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
      });
    }
  });
});
