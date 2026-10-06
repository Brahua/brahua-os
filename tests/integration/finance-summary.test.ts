// F3 of `finance` against the throwaway database: the month's summary from the stored rows (USD
// with the rate stored on each expense and without one, deleted ones out, recurring vs one-off),
// Lima's month boundaries at 00:00 in Lima, a fixed number of queries and authorization. The page
// sums with summary.ts over the rows `listMonthExpenses` already loaded: no extra query.
import { revalidatePath } from "next/cache";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createExpense, deleteExpense } from "@/modules/finance/actions";
import {
  createCategory,
  createPaymentMethod,
  setExchangeRate,
} from "@/modules/finance/catalog-actions";
import type { FinanceCatalog } from "@/modules/finance/catalog-input";
import { financeExpenses, financeRecurringPayments } from "@/modules/finance/db/schema";
import type { ExpenseItem } from "@/modules/finance/expense-input";
import { selectMonthExpenses } from "@/modules/finance/expenses";
import { listMonthExpenses } from "@/modules/finance/queries";
import { parseMonth } from "@/modules/finance/routes";
import { summarizeMonth } from "@/modules/finance/summary";
import { ownerDateKey } from "@/lib/time";
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

// The query-count spies and the fake clock: restored even when an assertion fails first.
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function catalogAfter(result: Promise<{ ok: boolean; data?: FinanceCatalog }>) {
  const settled = await result;
  if (!settled.ok || !settled.data)
    throw new Error(`Catalog action failed: ${JSON.stringify(settled)}`);
  return settled.data;
}

async function expense(input: Record<string, unknown>): Promise<ExpenseItem> {
  const result = await createExpense(input);
  if (!result.ok) throw new Error(`createExpense failed: ${JSON.stringify(result)}`);
  return result.data;
}

/** A recurring payment straight in the database (F2 creates them), for `recurring_payment_id`. */
async function recurringPayment(name: string) {
  const [row] = await testDb
    .insert(financeRecurringPayments)
    .values({
      name,
      amountCents: 5000,
      currency: "PEN",
      cycle: "monthly",
      dayOfMonth: 8,
      startDate: "2026-01-08",
    })
    .returning({ id: financeRecurringPayments.id });
  return row.id;
}

describe("the month's summary from the database", () => {
  test("total in PEN with each stored rate, USD without a rate apart, deleted out, by group", async () => {
    const comidaCatalog = await catalogAfter(createCategory({ name: "Comida" }));
    const comida = comidaCatalog.categories[0];
    const efectivo = (
      await catalogAfter(createPaymentMethod({ name: "Efectivo", currency: "PEN" }))
    ).methods[0];
    const dolares = (
      await catalogAfter(createPaymentMethod({ name: "Débito dólares", currency: "USD" }))
    ).methods.find((method) => method.currency === "USD")!;

    // No rate yet: this USD expense is stored without one ("sin convertir").
    await expense({ amount: "20", paymentMethodId: dolares.id, spentOn: "2026-09-03" });
    await catalogAfter(setExchangeRate({ rate: "3.75" }));
    await expense({ amount: "95", paymentMethodId: dolares.id, spentOn: "2026-09-10" });
    // A new rate later does not rewrite the stored one.
    await catalogAfter(setExchangeRate({ rate: "3.80" }));
    await expense({ amount: "10", paymentMethodId: dolares.id, spentOn: "2026-09-11" });
    await expense({
      amount: "12,50",
      categoryId: comida.id,
      paymentMethodId: efectivo.id,
      spentOn: "2026-09-30",
    });
    const gone = await expense({
      amount: "999",
      paymentMethodId: efectivo.id,
      spentOn: "2026-09-15",
    });
    expect((await deleteExpense({ id: gone.id })).ok).toBe(true);
    // Another month.
    await expense({ amount: "7", paymentMethodId: efectivo.id, spentOn: "2026-10-01" });
    // A recurring payment's expense (F2's "Pagado" sets the link): straight in the table.
    const recurringId = await recurringPayment("Streaming");
    await testDb.insert(financeExpenses).values({
      amountCents: 5000,
      currency: "PEN",
      spentOn: "2026-09-08",
      recurringPaymentId: recurringId,
      recurringDueOn: "2026-09-08",
    });

    const summary = summarizeMonth("2026-09", await listMonthExpenses("2026-09"));
    // 356.25 (95 × 3.75) + 38.00 (10 × 3.80) + 12.50 + 50.00; USD 20 apart.
    expect(summary.total).toEqual({
      penCents: 35_625 + 3_800 + 1_250 + 5_000,
      unconvertedUsdCents: 2_000,
      count: 5,
    });
    expect(summary.categories.map((group) => [group.name, group.penCents, group.percent])).toEqual([
      ["Comida", 1_250, 3],
      [null, 35_625 + 3_800 + 5_000, 97],
    ]);
    expect(
      summary.methods.map((group) => [group.name, group.penCents, group.unconvertedUsdCents]),
    ).toEqual([
      ["Débito dólares", 39_425, 2_000],
      ["Efectivo", 1_250, 0],
      [null, 5_000, 0],
    ]);
    expect(summary.recurring).toEqual({ penCents: 5_000, unconvertedUsdCents: 0, count: 1 });
    expect(summary.oneOff).toEqual({
      penCents: 39_425 + 1_250,
      unconvertedUsdCents: 2_000,
      count: 4,
    });
  });

  test("one query for the month's rows, whatever their number (the summary adds none)", async () => {
    const comida = (await catalogAfter(createCategory({ name: "Comida" }))).categories[0];
    for (let index = 0; index < 12; index += 1) {
      await expense({
        amount: String(index + 1),
        categoryId: index % 2 === 0 ? comida.id : null,
        spentOn: `2026-09-${String(index + 1).padStart(2, "0")}`,
      });
    }
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    const rows = await selectMonthExpenses(testDb, "2026-09");
    const summary = summarizeMonth("2026-09", rows);
    expect(summary.total.count).toBe(12);
    expect(select).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("Lima's month boundaries", () => {
  test("at 23:59:59 on Oct 31 in Lima an expense counts in October; at 00:00 it is November", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 23:59:59 in Lima is already Nov 1 in UTC. Only Date is faked; the session is made after.
    vi.setSystemTime(new Date("2026-11-01T04:59:59.000Z"));
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
    const late = await expense({ amount: "1" });
    expect(late.spentOn).toBe("2026-10-31");
    expect(parseMonth(undefined, ownerDateKey(new Date()).slice(0, 7))).toBe("2026-10");

    vi.setSystemTime(new Date("2026-11-01T05:00:00.000Z"));
    const early = await expense({ amount: "2" });
    expect(early.spentOn).toBe("2026-11-01");
    // The current month moved: "Mes" without ?mes= is November, and ?mes=2026-11 is valid.
    const current = ownerDateKey(new Date()).slice(0, 7);
    expect(current).toBe("2026-11");
    expect(parseMonth("2026-11", current)).toBe("2026-11");

    const october = summarizeMonth("2026-10", await listMonthExpenses("2026-10"));
    const november = summarizeMonth("2026-11", await listMonthExpenses("2026-11"));
    expect(october.total).toEqual({ penCents: 100, unconvertedUsdCents: 0, count: 1 });
    expect(november.total).toEqual({ penCents: 200, unconvertedUsdCents: 0, count: 1 });
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the month's rows (and so its summary) are never read", async (_, headers) => {
    await expense({ amount: "5", spentOn: "2026-09-01" });
    request.headers = await headers();
    await expect(listMonthExpenses("2026-09")).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
    // Positive control: the owner reads it.
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
    expect(summarizeMonth("2026-09", await listMonthExpenses("2026-09")).total.count).toBe(1);
  });
});
