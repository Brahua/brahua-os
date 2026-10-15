// finance-motion M2 against the throwaway database: `getMonthlyTotals` (six months, whole and up to
// a day) from the stored rows. It must agree with the summary's conversion (each stored rate, USD
// without one apart), leave deleted expenses and other months out, and need the owner.
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { financeExpenses } from "@/modules/finance/db/schema";
import { getMonthlyTotals } from "@/modules/finance/queries";
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
