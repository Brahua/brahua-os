// finance-motion M3 against the throwaway database: a new category takes the first free accent slot
// (colors repeat in order past eight), an archived one frees its slot, the expenses carry their
// category's slot, and the table refuses a slot outside 1…8.
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createExpense } from "@/modules/finance/actions";
import { archiveCategory, createCategory } from "@/modules/finance/catalog-actions";
import { financeCategories } from "@/modules/finance/db/schema";
import { listMonthExpenses } from "@/modules/finance/queries";
import { AUTH_ENV, OWNER, sessionCookieFor } from "./owner-session";
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

const slots = async () =>
  Object.fromEntries(
    (await testDb.select().from(financeCategories)).map((row) => [row.name, row.colorSlot]),
  );

async function create(name: string) {
  const result = await createCategory({ name });
  if (!result.ok) throw new Error(`createCategory failed: ${JSON.stringify(result)}`);
  return result.data.categories.find((item) => item.name === name)!;
}

describe("category accent slots", () => {
  test("new categories take 1, 2, 3…; an archived one frees its slot for the next", async () => {
    const a = await create("A");
    await create("B");
    await create("C");
    expect(await slots()).toEqual({ A: 1, B: 2, C: 3 });
    expect((await archiveCategory({ id: a.id })).ok).toBe(true);
    await create("D");
    expect((await slots()).D).toBe(1);
  });

  test("past eight the colors repeat in order", async () => {
    for (const name of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]) await create(name);
    const all = await slots();
    expect(all["8"]).toBe(8);
    expect(all["9"]).toBe(1);
    expect(all["10"]).toBe(2);
  });

  test("the month's expenses carry the slot of their category (none for no category)", async () => {
    await create("Casa");
    const comida = await create("Comida");
    const spentOn = "2026-09-10";
    expect((await createExpense({ amount: "5", categoryId: comida.id, spentOn })).ok).toBe(true);
    expect((await createExpense({ amount: "3", spentOn })).ok).toBe(true);
    const items = await listMonthExpenses("2026-09");
    expect(items.find((item) => item.category)?.category).toMatchObject({
      name: "Comida",
      colorSlot: 2,
    });
    expect(items.find((item) => !item.category)?.category).toBeNull();
  });

  test("the table refuses a slot outside 1…8", async () => {
    await expect(
      testDb.insert(financeCategories).values({ name: "Mala", sortOrder: 0, colorSlot: 9 }),
    ).rejects.toThrow();
    // Positive control: 8 is accepted, and so is none.
    await testDb.insert(financeCategories).values({ name: "Bien", sortOrder: 1, colorSlot: 8 });
    await testDb.insert(financeCategories).values({ name: "Sin", sortOrder: 2 });
    expect(await slots()).toMatchObject({ Bien: 8, Sin: null });
  });
});
