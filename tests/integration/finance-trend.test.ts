// finance-motion M2 against the throwaway database: `getMonthlyTotals` (six months, whole and up to
// a day) from the stored rows. It must agree with the summary's conversion (each stored rate, USD
// without one apart), leave deleted expenses and other months out, and need the owner.
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { financeExpenses } from "@/modules/finance/db/schema";
import { getMonthlyTotals, getPreviousMonthCumulative } from "@/modules/finance/queries";
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

type Row = {
  spentOn: string;
  amountCents: number;
  currency?: "PEN" | "USD";
  exchangeRate?: string | null;
  deletedAt?: Date;
};

async function insert(rows: Row[]) {
  await testDb.insert(financeExpenses).values(
    rows.map((row) => ({
      amountCents: row.amountCents,
      currency: row.currency ?? "PEN",
      exchangeRate: row.exchangeRate ?? null,
      spentOn: row.spentOn,
      deletedAt: row.deletedAt ?? null,
    })),
  );
}

describe("getMonthlyTotals", () => {
  test("six months ending at the month, whole and up to the day, converted like the summary", async () => {
    await insert([
      { spentOn: "2026-10-03", amountCents: 1000 },
      { spentOn: "2026-10-20", amountCents: 5000 },
      { spentOn: "2026-09-05", amountCents: 2000 },
      { spentOn: "2026-09-25", amountCents: 4000 },
      // USD with its stored rate (1.00 × 3.75 = 3.75) and USD without one (apart).
      { spentOn: "2026-09-10", amountCents: 100, currency: "USD", exchangeRate: "3.7500" },
      { spentOn: "2026-09-11", amountCents: 900, currency: "USD" },
      { spentOn: "2026-05-31", amountCents: 700 },
      // Controls that must not count: before the six months, after the month, deleted.
      { spentOn: "2026-04-30", amountCents: 999 },
      { spentOn: "2026-11-01", amountCents: 999 },
      { spentOn: "2026-09-12", amountCents: 999, deletedAt: new Date() },
    ]);
    const totals = await getMonthlyTotals("2026-10", 6, 14);
    expect(totals.map((total) => total.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(totals[0]).toMatchObject({ penCents: 700, uptoDayPenCents: 0 });
    expect(totals[4]).toEqual({
      month: "2026-09",
      penCents: 6375,
      uptoDayPenCents: 2375,
      unconvertedUsdCents: 900,
    });
    expect(totals[5]).toMatchObject({ penCents: 6000, uptoDayPenCents: 1000 });
  });

  test("an empty database gives six zero months", async () => {
    const totals = await getMonthlyTotals("2026-10");
    expect(totals).toHaveLength(6);
    expect(totals.every((total) => total.penCents === 0)).toBe(true);
  });

  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s nothing is read", async (_, headers) => {
    await insert([{ spentOn: "2026-10-03", amountCents: 1000 }]);
    request.headers = await headers();
    await expect(getMonthlyTotals("2026-10")).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
    // Positive control: the owner reads it.
    request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
    expect((await getMonthlyTotals("2026-10")).at(-1)?.penCents).toBe(1000);
  });
});

describe("getPreviousMonthCumulative", () => {
  test("the previous month's running total per day, bounded to the days of the asked month", async () => {
    await insert([
      { spentOn: "2026-09-01", amountCents: 100 },
      { spentOn: "2026-09-03", amountCents: 250 },
      { spentOn: "2026-09-30", amountCents: 9000 },
      { spentOn: "2026-09-05", amountCents: 100, currency: "USD", exchangeRate: "3.7500" },
      { spentOn: "2026-09-06", amountCents: 700, currency: "USD" },
      { spentOn: "2026-09-07", amountCents: 999, deletedAt: new Date() },
      // Other months never leak in.
      { spentOn: "2026-10-01", amountCents: 5555 },
      { spentOn: "2026-08-31", amountCents: 4444 },
    ]);
    // October has 31 days: September's 30 run flat on the 31st.
    const october = (await getPreviousMonthCumulative("2026-10"))!;
    expect(october).toHaveLength(31);
    expect(october.slice(0, 7)).toEqual([100, 100, 350, 350, 725, 725, 725]);
    expect(october[29]).toBe(9725);
    // A month with 30 days after one with 31: the 31st is ignored (August → September).
    const september = (await getPreviousMonthCumulative("2026-09"))!;
    expect(september).toHaveLength(30);
    // August 31st (4444) is outside September's 30 days: ignored.
    expect(september[29]).toBe(0);
  });

  test("no month before 2000-01; a month with nothing before is all zeros", async () => {
    expect(await getPreviousMonthCumulative("2000-01")).toBeNull();
    expect(await getPreviousMonthCumulative("2026-02")).toEqual(Array(28).fill(0));
  });
});
