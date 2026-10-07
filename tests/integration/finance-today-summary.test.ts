// F4 of `finance` against the throwaway database: the contract for `today`
// (`getFinanceTodaySummary`): who enters (pending periods of active payments, overdue ≤ 60 days or
// due within 7, by Lima's day), its order and DTO, the window's borders and Lima's midnight,
// archived / deleted / settled out, a fixed number of queries and authorization. And the home
// page's revalidation: the writes that change "Pagos" revalidate "/", the others don't.
import { revalidatePath } from "next/cache";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ownerDateKey } from "@/lib/time";
import { createExpense, deleteExpense, restoreExpense } from "@/modules/finance/actions";
import {
  createCategory,
  createPaymentMethod,
  setExchangeRate,
} from "@/modules/finance/catalog-actions";
import { getFinanceTodaySummary, selectFinanceTodaySummary } from "@/modules/finance/contracts";
import {
  financeExpenses,
  financePaymentMethods,
  financeRecurringPayments,
  financeSettlements,
} from "@/modules/finance/db/schema";
import {
  archiveRecurringPayment,
  createRecurringPayment,
  deleteRecurringPayment,
  editRecurringPayment,
  markPaid,
  restoreRecurringPayment,
  skipPeriod,
  unarchiveRecurringPayment,
  undoPaid,
  undoSkipped,
} from "@/modules/finance/payment-actions";
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

// Monday 2026-10-05, 10:00 in Lima. The window: 2026-08-06 (60 days back) to 2026-10-12 (7 ahead).
const NOW = new Date("2026-10-05T15:00:00Z");
// 23:59:59 in Lima on the 5th (already the 6th in UTC) and Lima's midnight a second later.
const LIMA_LAST_SECOND = new Date("2026-10-06T04:59:59Z");
const LIMA_MIDNIGHT = new Date("2026-10-06T05:00:00Z");

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

// The query-count spies: restored even when an assertion fails first.
afterEach(() => {
  vi.restoreAllMocks();
});

type NewRecurring = Partial<typeof financeRecurringPayments.$inferInsert> & { name: string };

/** A recurring payment straight in the database: monthly on the 6th, S/ 50, since January. */
async function recurring(values: NewRecurring) {
  const [row] = await testDb
    .insert(financeRecurringPayments)
    .values({
      amountCents: 5_000,
      currency: "PEN",
      cycle: "monthly",
      dayOfMonth: 6,
      startDate: "2026-01-01",
      ...values,
    })
    .returning();
  return row;
}

async function method(name: string, currency: "PEN" | "USD" = "PEN") {
  const [row] = await testDb
    .insert(financePaymentMethods)
    .values({ name, currency, sortOrder: 0 })
    .returning();
  return row;
}

/** A paid period: its expense and the `paid` settlement. */
async function paidPeriod(recurringId: string, dueOn: string) {
  const [expense] = await testDb
    .insert(financeExpenses)
    .values({
      amountCents: 5_000,
      currency: "PEN",
      spentOn: dueOn,
      recurringPaymentId: recurringId,
      recurringDueOn: dueOn,
    })
    .returning();
  await testDb
    .insert(financeSettlements)
    .values({ recurringPaymentId: recurringId, dueOn, status: "paid", expenseId: expense.id });
}

const periods = (items: { name: string; dueOn: string }[]) =>
  items.map((item) => `${item.dueOn} ${item.name}`);

describe("getFinanceTodaySummary", () => {
  test("pending periods of active payments, overdue ≤ 60 days or due within 7, by date then name", async () => {
    const usd = await method("Débito dólares", "USD");
    await recurring({ name: "Agua" }); // 08-06, 09-06, 10-06
    await recurring({ name: "Luz", amountCents: null, dayOfMonth: 5 }); // 08-05 is 61 days back
    await recurring({
      name: "Gimnasio",
      cycle: "weekly",
      dayOfMonth: null,
      weekday: 1, // Mondays: 10-05 and 10-12 (exactly 7 ahead)
      startDate: "2026-10-01",
      amountCents: 2_500,
      currency: "USD",
      paymentMethodId: usd.id,
    });
    await recurring({ name: "Seguro", dayOfMonth: 13 }); // 10-13 is 8 ahead
    // Out: archived, deleted, starting later, and fully settled (skipped and paid).
    await recurring({ name: "Archivado", archivedAt: new Date("2026-09-01T00:00:00Z") });
    await recurring({ name: "Eliminado", deletedAt: new Date("2026-09-01T00:00:00Z") });
    await recurring({ name: "Futuro", startDate: "2026-10-20" });
    const netflix = await recurring({ name: "Netflix", dayOfMonth: 1, startDate: "2026-09-01" });
    await testDb
      .insert(financeSettlements)
      .values({ recurringPaymentId: netflix.id, dueOn: "2026-09-01", status: "skipped" });
    await paidPeriod(netflix.id, "2026-10-01");

    const items = await getFinanceTodaySummary(NOW);
    expect(periods(items)).toEqual([
      "2026-08-06 Agua",
      "2026-08-13 Seguro",
      "2026-09-05 Luz",
      "2026-09-06 Agua",
      "2026-09-13 Seguro",
      "2026-10-05 Gimnasio",
      "2026-10-05 Luz",
      "2026-10-06 Agua",
      "2026-10-12 Gimnasio",
    ]);
    const gym = items.find((item) => item.name === "Gimnasio");
    expect(gym).toEqual({
      recurringId: expect.any(String),
      name: "Gimnasio",
      dueOn: "2026-10-05",
      amountCents: 2_500,
      currency: "USD",
      paymentMethod: { id: usd.id, name: "Débito dólares" },
      installment: null,
    });
    expect(items.find((item) => item.name === "Luz")).toMatchObject({
      amountCents: null,
      paymentMethod: null,
    });
  });

  test("the window's borders: 60 days back and 7 ahead are in, 61 and 8 are out", async () => {
    await recurring({ name: "Borde atrás", dayOfMonth: 6 }); // 08-06: day −60
    await recurring({ name: "Fuera atrás", dayOfMonth: 5, startDate: "2026-08-01" }); // 08-05: −61
    await recurring({ name: "Borde adelante", dayOfMonth: 12, startDate: "2026-10-01" }); // +7
    await recurring({ name: "Fuera adelante", dayOfMonth: 13, startDate: "2026-10-01" }); // +8
    const items = await getFinanceTodaySummary(NOW);
    expect(items.filter((item) => item.name === "Borde atrás").map((item) => item.dueOn)).toEqual([
      "2026-08-06",
      "2026-09-06",
      "2026-10-06",
    ]);
    expect(items.filter((item) => item.name === "Fuera atrás").map((item) => item.dueOn)).toEqual([
      "2026-09-05",
      "2026-10-05",
    ]);
    expect(
      items.filter((item) => item.name === "Borde adelante").map((item) => item.dueOn),
    ).toEqual(["2026-10-12"]);
    expect(items.some((item) => item.name === "Fuera adelante")).toBe(false);
  });

  test("Lima's day decides: 23:59:59 is still the 5th, a second later the window moves", async () => {
    await recurring({ name: "Agua" }); // 08-06, 09-06, 10-06
    await recurring({ name: "Seguro", dayOfMonth: 13 }); // 10-13
    expect(periods(await getFinanceTodaySummary(LIMA_LAST_SECOND))).toEqual([
      "2026-08-06 Agua",
      "2026-08-13 Seguro",
      "2026-09-06 Agua",
      "2026-09-13 Seguro",
      "2026-10-06 Agua",
    ]);
    // The 6th in Lima: 08-06 is now 61 days back, 10-13 is 7 ahead.
    expect(periods(await getFinanceTodaySummary(LIMA_MIDNIGHT))).toEqual([
      "2026-08-13 Seguro",
      "2026-09-06 Agua",
      "2026-09-13 Seguro",
      "2026-10-06 Agua",
      "2026-10-13 Seguro",
    ]);
  });

  test("a settled period leaves; the rest of the payment stays (positive control)", async () => {
    const agua = await recurring({ name: "Agua" });
    await paidPeriod(agua.id, "2026-09-06");
    await testDb
      .insert(financeSettlements)
      .values({ recurringPaymentId: agua.id, dueOn: "2026-08-06", status: "skipped" });
    expect(periods(await getFinanceTodaySummary(NOW))).toEqual(["2026-10-06 Agua"]);
  });

  test("empty when nothing is pending", async () => {
    await recurring({ name: "Tranquilo", dayOfMonth: 20, startDate: "2026-10-15" });
    expect(await getFinanceTodaySummary(NOW)).toEqual([]);
  });

  test("two queries, whatever the number of payments and periods (no query per payment)", async () => {
    const usd = await method("Débito dólares", "USD");
    for (let index = 0; index < 6; index += 1) {
      const row = await recurring({ name: `Pago ${index}`, paymentMethodId: usd.id });
      await paidPeriod(row.id, "2026-09-06");
    }
    // The data function (the queries alone, without the owner check's session read).
    const select = vi.spyOn(testDb, "select");
    const execute = vi.spyOn(testDb, "execute");
    const items = await selectFinanceTodaySummary(testDb, NOW);
    expect(items).toHaveLength(12);
    expect(select).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
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
  ])("with %s it redirects to /login", async (_, headers) => {
    await recurring({ name: "Agua", startDate: "2026-10-01" });
    // Positive control: the owner sees it.
    expect(periods(await getFinanceTodaySummary(NOW))).toEqual(["2026-10-06 Agua"]);
    request.headers = await headers();
    await expect(getFinanceTodaySummary(NOW)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});

describe("the home page is revalidated by what changes Pagos", () => {
  const home = () => vi.mocked(revalidatePath).mock.calls.some(([path]) => path === "/");

  function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(`Action failed: ${JSON.stringify(result)}`);
    return result.data;
  }

  /** A monthly payment due today by the real clock (the actions use Lima's today). */
  async function dueToday() {
    const today = ownerDateKey(new Date());
    return unwrap(
      await createRecurringPayment({
        name: "Internet",
        variable: false,
        amount: "50",
        currency: "PEN",
        categoryId: null,
        paymentMethodId: null,
        cycle: "monthly",
        weekday: null,
        dayOfMonth: Number(today.slice(8, 10)),
        intervalMonths: null,
        anchorMonth: null,
        startDate: today,
        notes: null,
      }),
    );
  }

  test("create, pay, undo, skip, undo, edit, archive, reactivate, delete and restore a payment; delete and restore its expense", async () => {
    const today = ownerDateKey(new Date());
    const item = await dueToday();
    expect({ name: "createRecurringPayment", home: home() }).toEqual({
      name: "createRecurringPayment",
      home: true,
    });
    vi.mocked(revalidatePath).mockClear();
    const steps: [string, () => Promise<{ ok: boolean }>][] = [];
    const paid = unwrap(await markPaid({ id: item.id, dueOn: today }));
    expect(home()).toBe(true);
    steps.push(
      ["deleteExpense", () => deleteExpense({ id: paid.expense.id })],
      ["restoreExpense", () => restoreExpense({ id: paid.expense.id })],
      ["undoPaid", () => undoPaid({ id: item.id, dueOn: today, expenseId: paid.expense.id })],
      ["skipPeriod", () => skipPeriod({ id: item.id, dueOn: today })],
      ["undoSkipped", () => undoSkipped({ id: item.id, dueOn: today })],
      [
        "editRecurringPayment",
        () =>
          editRecurringPayment({
            id: item.id,
            name: "Internet fibra",
            variable: false,
            amount: "60",
            currency: "PEN",
            categoryId: null,
            paymentMethodId: null,
            cycle: item.cycle,
            weekday: item.weekday,
            dayOfMonth: item.dayOfMonth,
            intervalMonths: item.intervalMonths,
            anchorMonth: item.anchorMonth,
            startDate: item.startDate,
            notes: null,
          }),
      ],
      ["archiveRecurringPayment", () => archiveRecurringPayment({ id: item.id })],
      ["unarchiveRecurringPayment", () => unarchiveRecurringPayment({ id: item.id })],
      ["deleteRecurringPayment", () => deleteRecurringPayment({ id: item.id })],
      ["restoreRecurringPayment", () => restoreRecurringPayment({ id: item.id })],
    );
    for (const [name, run] of steps) {
      vi.mocked(revalidatePath).mockClear();
      expect({ name, ok: (await run()).ok }).toEqual({ name, ok: true });
      expect({ name, home: home() }).toEqual({ name, home: true });
    }
  });

  test("a method revalidates it (its name shows in the rows); a loose expense, a category and the rate don't", async () => {
    expect((await createPaymentMethod({ name: "Yape", currency: "PEN" })).ok).toBe(true);
    expect(home()).toBe(true);

    vi.mocked(revalidatePath).mockClear();
    expect((await createCategory({ name: "Casa" })).ok).toBe(true);
    expect((await setExchangeRate({ rate: "3.75" })).ok).toBe(true);
    expect((await createExpense({ amount: "12.50" })).ok).toBe(true);
    expect(home()).toBe(false);
    // Positive control: they did revalidate /finance.
    expect(revalidatePath).toHaveBeenCalledWith("/finance", "layout");
  });
});
