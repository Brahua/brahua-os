// `pnpm db:finance:import` (scripts/finance-import.ts) against the throwaway database, with a
// fictitious file: the mapping (monthly day, variable, archived, USD method, start at the next due
// date so nothing is overdue), idempotency, a name clash aborts with nothing written (with a
// positive control), unknown references, contiguous sort_order after existing rows, the dry run
// writes nothing, and the demo scripts never touch `finance_*`.
import { asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seed } from "@/modules/core/seed";
import {
  financeCategories,
  financePaymentMethods,
  financeRecurringPayments,
} from "@/modules/finance/db/schema";
import { selectPaymentsView } from "@/modules/finance/recurring";
import { ownerDateKey } from "@/lib/time";
import {
  insertDemoData,
  MODULE_TABLES,
  removeDemoData,
  replaceWithDemoData,
} from "../../scripts/demo-data";
import {
  FinanceImportError,
  importCategoryId,
  importFileSchema,
  importFinance,
  importMethodId,
  importRecurringId,
  type ImportFile,
} from "../../scripts/finance-import";
import { testDb } from "./test-db";

const ID = {
  services: "11111111111111111111111111111111",
  leisure: "2222222222222222-2222-2222-22222222", // dashes are allowed anywhere
  a: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  b: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  c: "cccccccccccccccccccccccccccccccc",
  d: "dddddddddddddddddddddddddddddddd",
  e: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
};

/** A fictitious export (never real data: the repo is public). */
function fixture(): ImportFile {
  return importFileSchema.parse({
    source: "notion",
    exportedAt: "2026-02-27T12:00:00-05:00",
    categories: [
      { notionId: ID.services, name: "Servicios" },
      { notionId: ID.leisure, name: "Ocio" },
    ],
    paymentMethods: [
      { name: "Tarjeta X", currency: "PEN" },
      { name: "Débito dólares", currency: "USD" },
    ],
    recurring: [
      // Day 31 in February: due on the 28th (today) → starts today.
      {
        notionId: ID.a,
        name: "Servicio A",
        amount: 49.9,
        dayOfMonth: 31,
        active: true,
        paymentMethod: "tarjeta x",
        category: ID.services,
      },
      // Day 10 already passed this month → starts March 10.
      {
        notionId: ID.b,
        name: "Streaming B",
        amount: 12,
        dayOfMonth: 10,
        active: true,
        paymentMethod: "Débito dólares",
        category: ID.leisure,
      },
      // Variable.
      {
        notionId: ID.c,
        name: "Luz C",
        amount: null,
        dayOfMonth: 1,
        active: true,
        paymentMethod: null,
        category: ID.services,
      },
      // Inactive → archived.
      {
        notionId: ID.d,
        name: "Gimnasio D",
        amount: 99.5,
        dayOfMonth: 5,
        active: false,
        paymentMethod: "Tarjeta X",
        category: null,
      },
    ],
  });
}

/** Saturday 2026-02-28 (the last day of February), 10:00 in Lima. */
const NOW = new Date("2026-02-28T15:00:00Z");
const TODAY = "2026-02-28";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Every row of the three tables the import writes, as sorted JSON. */
async function snapshot(
  tables = ["finance_categories", "finance_payment_methods", "finance_recurring_payments"],
) {
  const out: Record<string, string[]> = {};
  for (const table of tables) {
    const result = await testDb.execute<{ row: string }>(
      sql`select to_jsonb(t)::text as row from ${sql.identifier(table)} t order by 1`,
    );
    out[table] = result.rows.map((r) => r.row);
  }
  return out;
}

async function recurringRow(notionId: string) {
  const [row] = await testDb
    .select()
    .from(financeRecurringPayments)
    .where(eq(financeRecurringPayments.id, importRecurringId(notionId)));
  return row;
}

describe("mapping", () => {
  test("monthly on its day, PEN, variable, archived, USD method and references", async () => {
    expect(ownerDateKey(new Date())).toBe(TODAY);
    const report = await importFinance(testDb, fixture(), new Date(), { dryRun: false });
    expect(report).toEqual({
      dryRun: false,
      today: TODAY,
      exportedAt: "2026-02-27T12:00:00-05:00",
      categories: { inserted: 2, skipped: 0 },
      methods: { inserted: 2, skipped: 0 },
      recurring: { inserted: 4, skipped: 0, active: 3, archived: 1, variable: 1 },
      // Imported in PEN as in Notion, with the USD method: the owner checks it in the app.
      warnings: [
        "«Streaming B»: se paga con un medio en USD; se importa en PEN (revísalo en la app)",
      ],
    });

    const a = await recurringRow(ID.a);
    expect(a).toMatchObject({
      name: "Servicio A",
      amountCents: 4990,
      currency: "PEN",
      cycle: "monthly",
      dayOfMonth: 31,
      weekday: null,
      intervalMonths: null,
      anchorMonth: null,
      startDate: TODAY, // the 31st clamps to Feb 28, which is today
      installmentsTotal: null, // imported payments never end on their own
      archivedAt: null,
      deletedAt: null,
      categoryId: importCategoryId(ID.services),
      paymentMethodId: importMethodId("Tarjeta X"), // matched in any case
    });
    expect(await recurringRow(ID.b)).toMatchObject({
      amountCents: 1200,
      currency: "PEN",
      startDate: "2026-03-10",
      paymentMethodId: importMethodId("débito dólares"),
      categoryId: importCategoryId(ID.leisure),
    });
    expect(await recurringRow(ID.c)).toMatchObject({
      amountCents: null,
      startDate: "2026-03-01",
      paymentMethodId: null,
    });
    const d = await recurringRow(ID.d);
    expect(d.archivedAt?.toISOString()).toBe(NOW.toISOString());
    expect(d).toMatchObject({ amountCents: 9950, startDate: "2026-03-05", categoryId: null });

    const [usd] = await testDb
      .select()
      .from(financePaymentMethods)
      .where(eq(financePaymentMethods.name, "Débito dólares"));
    expect(usd.currency).toBe("USD");
  });

  test("nothing is overdue on day one: the Pagos view only has periods due from today", async () => {
    await importFinance(testDb, fixture(), new Date(), { dryRun: false });
    const view = await selectPaymentsView(testDb, TODAY);
    expect(view.pending.length).toBeGreaterThan(0); // positive control: the due-today one shows
    for (const period of view.pending) expect(period.dueOn >= TODAY).toBe(true);
    expect(view.pending.map((p) => [p.recurring.name, p.dueOn])).toEqual([
      ["Servicio A", TODAY],
      ["Luz C", "2026-03-01"],
    ]);
    expect(view.active.map((entry) => entry.recurring.name).sort()).toEqual([
      "Luz C",
      "Servicio A",
      "Streaming B",
    ]);
    expect(view.archived.map((item) => item.name)).toEqual(["Gimnasio D"]);
  });

  test("the 31st in a 30-day month starts on its last day (April 30)", async () => {
    vi.setSystemTime(new Date("2026-04-29T15:00:00Z"));
    await importFinance(testDb, fixture(), new Date(), { dryRun: false });
    expect((await recurringRow(ID.a)).startDate).toBe("2026-04-30");
    expect((await recurringRow(ID.b)).startDate).toBe("2026-05-10");
  });

  test("unknown references become null with a warning each", async () => {
    const file = fixture();
    file.recurring[0] = { ...file.recurring[0], paymentMethod: "Billetera Z", category: ID.e };
    const report = await importFinance(testDb, file, new Date(), { dryRun: false });
    expect(report.warnings).toEqual([
      `"Servicio A": unknown category "${ID.e}" (left without one).`,
      `"Servicio A": unknown payment method "Billetera Z" (left without one).`,
      "«Streaming B»: se paga con un medio en USD; se importa en PEN (revísalo en la app)",
    ]);
    expect(await recurringRow(ID.a)).toMatchObject({ categoryId: null, paymentMethodId: null });
  });
});

describe("locks", () => {
  test("the catalog lock comes first: a holder blocks the import until it releases", async () => {
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(5000, hashtext('finance:categories'))");
      let done = false;
      const run = importFinance(testDb, fixture(), new Date(), { dryRun: false }).then((r) => {
        done = true;
        return r;
      });
      // Wait until the import's backend is waiting on that advisory lock (not just slow).
      await vi.waitFor(
        async () => {
          const waiting = await testDb.execute<{ count: number }>(
            sql`select count(*)::int as count from pg_locks
                where locktype = 'advisory' and not granted and classid = 5000`,
          );
          expect(Number(waiting.rows[0].count)).toBe(1);
        },
        { timeout: 5_000, interval: 50 },
      );
      expect(done).toBe(false);
      expect((await snapshot()).finance_categories).toEqual([]);

      await holder.query("commit");
      // Positive control: once released, the import completes.
      const report = await run;
      expect(done).toBe(true);
      expect(report.categories.inserted).toBe(2);
    } finally {
      await holder.query("rollback").catch(() => {});
      holder.release();
    }
  });
});

describe("idempotency and the owner's edits", () => {
  test("a second run inserts nothing and keeps what the owner changed", async () => {
    await importFinance(testDb, fixture(), new Date(), { dryRun: false });
    // The owner edits, archives and deletes imported rows.
    await testDb
      .update(financeRecurringPayments)
      .set({ name: "Servicio A (editado)", amountCents: 5500 })
      .where(eq(financeRecurringPayments.id, importRecurringId(ID.a)));
    await testDb
      .update(financeCategories)
      .set({ archivedAt: new Date() })
      .where(eq(financeCategories.id, importCategoryId(ID.leisure)));
    await testDb
      .update(financeRecurringPayments)
      .set({ deletedAt: new Date() })
      .where(eq(financeRecurringPayments.id, importRecurringId(ID.b)));
    const before = await snapshot();

    const report = await importFinance(testDb, fixture(), new Date(), { dryRun: false });
    expect(report.categories).toEqual({ inserted: 0, skipped: 2 });
    expect(report.methods).toEqual({ inserted: 0, skipped: 2 });
    expect(report.recurring).toMatchObject({ inserted: 0, skipped: 4 });
    expect(await snapshot()).toEqual(before);
  });

  test("a file with a new entry adds only that one", async () => {
    await importFinance(testDb, fixture(), new Date(), { dryRun: false });
    const file = fixture();
    file.recurring.push({
      notionId: ID.e,
      name: "Seguro E",
      amount: 30,
      dayOfMonth: 20,
      active: true,
      paymentMethod: null,
      category: null,
    });
    const report = await importFinance(testDb, file, new Date(), { dryRun: false });
    expect(report.recurring).toMatchObject({ inserted: 1, skipped: 4 });
    expect((await recurringRow(ID.e)).startDate).toBe("2026-03-20");
  });
});

describe("catalog order and name clashes", () => {
  test("new catalog rows go after the existing ones, contiguous", async () => {
    await testDb.insert(financeCategories).values([
      { name: "Comida", sortOrder: 0 },
      { name: "Casa", sortOrder: 1 },
    ]);
    await testDb.insert(financePaymentMethods).values({ name: "Efectivo", sortOrder: 0 });
    await importFinance(testDb, fixture(), new Date(), { dryRun: false });

    const categories = await testDb
      .select({ name: financeCategories.name, sortOrder: financeCategories.sortOrder })
      .from(financeCategories)
      .orderBy(asc(financeCategories.sortOrder));
    expect(categories).toEqual([
      { name: "Comida", sortOrder: 0 },
      { name: "Casa", sortOrder: 1 },
      { name: "Servicios", sortOrder: 2 },
      { name: "Ocio", sortOrder: 3 },
    ]);
    const methods = await testDb
      .select({ name: financePaymentMethods.name, sortOrder: financePaymentMethods.sortOrder })
      .from(financePaymentMethods)
      .orderBy(asc(financePaymentMethods.sortOrder));
    expect(methods).toEqual([
      { name: "Efectivo", sortOrder: 0 },
      { name: "Tarjeta X", sortOrder: 1 },
      { name: "Débito dólares", sortOrder: 2 },
    ]);
  });

  test("a visible name of another id (any case) aborts with nothing written", async () => {
    await testDb.insert(financePaymentMethods).values({ name: "TARJETA x", sortOrder: 0 });
    const before = await snapshot();
    const run = importFinance(testDb, fixture(), new Date(), { dryRun: false });
    await expect(run).rejects.toThrow(FinanceImportError);
    await expect(run).rejects.toThrow(/payment method "TARJETA x".*Nothing was written/);
    expect(await snapshot()).toEqual(before);
  });

  test("positive control: an archived row with that name does not clash", async () => {
    await testDb
      .insert(financePaymentMethods)
      .values({ name: "TARJETA x", sortOrder: 0, archivedAt: new Date() });
    const report = await importFinance(testDb, fixture(), new Date(), { dryRun: false });
    expect(report.methods.inserted).toBe(2);
  });
});

describe("dry run", () => {
  test("reports what it would insert and writes nothing", async () => {
    const before = await snapshot();
    const report = await importFinance(testDb, fixture(), new Date(), { dryRun: true });
    expect(report).toMatchObject({
      dryRun: true,
      categories: { inserted: 2, skipped: 0 },
      methods: { inserted: 2, skipped: 0 },
      recurring: { inserted: 4, skipped: 0 },
    });
    expect(await snapshot()).toEqual(before);
    // Positive control: the same file really imports.
    await importFinance(testDb, fixture(), new Date(), { dryRun: false });
    expect((await snapshot()).finance_recurring_payments).toHaveLength(4);
  });

  test("reports a clash too", async () => {
    await testDb.insert(financeCategories).values({ name: "ocio", sortOrder: 0 });
    await expect(importFinance(testDb, fixture(), new Date(), { dryRun: true })).rejects.toThrow(
      /category "ocio"/,
    );
  });
});

describe("the demo scripts never touch finance", () => {
  test("db:demo, db:demo:remove and db:demo:replace leave finance_* as they were", async () => {
    expect(MODULE_TABLES.some((table) => table.startsWith("finance_"))).toBe(false);
    await seed(testDb);
    await importFinance(testDb, fixture(), new Date(), { dryRun: false });
    const financeTables = [
      "finance_categories",
      "finance_payment_methods",
      "finance_recurring_payments",
      "finance_expenses",
      "finance_settlements",
      "finance_settings",
    ];
    const before = await snapshot(financeTables);
    expect(before.finance_recurring_payments).toHaveLength(4); // something that could be lost

    await insertDemoData(testDb, NOW);
    expect(await snapshot(financeTables)).toEqual(before);
    await removeDemoData(testDb);
    expect(await snapshot(financeTables)).toEqual(before);
    await replaceWithDemoData(testDb, NOW);
    expect(await snapshot(financeTables)).toEqual(before);
  });
});
