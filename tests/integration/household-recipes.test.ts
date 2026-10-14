// H3 of `household` against the throwaway database: the table's CHECKs with raw inserts (defense in
// depth behind Zod), adding, editing, «Quitar» and its «Deshacer», authorization and the export.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { householdRecipes } from "@/modules/household/db/schema";
import {
  addRecipe,
  editRecipe,
  removeRecipe,
  undoRemoveRecipe,
} from "@/modules/household/recipe-actions";
import { getRecipes } from "@/modules/household/recipe-queries";
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
  const result = await addRecipe(input);
  if (!result.ok) throw new Error(`addRecipe failed: ${JSON.stringify(result)}`);
  return result.data;
}

const rowOf = async (id: string) =>
  (await testDb.select().from(householdRecipes).where(eq(householdRecipes.id, id)))[0];

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

describe("the table's own CHECKs", () => {
  test("a bare row goes in, with empty lists and no link", async () => {
    const [row] = await testDb.insert(householdRecipes).values({ name: "Sopa" }).returning();
    expect(row).toMatchObject({ mealTypes: [], weekdays: [], url: null, deletedAt: null });
  });

  test.each([
    ["an empty name", { name: "" }, "household_recipes_name_check"],
    ["a name of 121 characters", { name: "x".repeat(121) }, "household_recipes_name_check"],
    ["an unknown meal", { mealTypes: ["brunch"] }, "household_recipes_meal_types_check"],
    ["seven meals", { mealTypes: Array(7).fill("lunch") }, "household_recipes_meal_types_check"],
    ["weekday 0", { weekdays: [0] }, "household_recipes_weekdays_check"],
    ["weekday 8", { weekdays: [8] }, "household_recipes_weekdays_check"],
    ["eight weekdays", { weekdays: [1, 1, 1, 1, 1, 1, 1, 1] }, "household_recipes_weekdays_check"],
    ["a javascript link", { url: "javascript:alert(1)" }, "household_recipes_url_check"],
    ["a link without a scheme", { url: "example.com" }, "household_recipes_url_check"],
    ["a link with a space", { url: "https://example.com/a b" }, "household_recipes_url_check"],
    ["an empty link", { url: "" }, "household_recipes_url_check"],
    [
      "a link of 2001 characters",
      { url: `https://e.co/${"x".repeat(1990)}` },
      "household_recipes_url_check",
    ],
  ] as const)("%s is refused", async (_, patch, constraint) => {
    const result = await violation(() =>
      testDb.insert(householdRecipes).values({ name: "Sopa", ...(patch as object) }),
    );
    expect(result).toEqual({ code: "23514", constraint });
  });

  test("the limits themselves are fine (positive controls)", async () => {
    await testDb.insert(householdRecipes).values({
      name: "x".repeat(120),
      mealTypes: ["breakfast", "midmorning", "lunch", "afternoon", "snack", "dinner"],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      url: `https://e.co/${"x".repeat(1900)}`,
    });
    expect(await testDb.select().from(householdRecipes)).toHaveLength(1);
  });

  test("two recipes may share a name", async () => {
    await testDb.insert(householdRecipes).values([{ name: "Sopa" }, { name: "Sopa" }]);
    expect(await testDb.select().from(householdRecipes)).toHaveLength(2);
  });
});

describe("adding and editing", () => {
  test("adds a normalized recipe with deduped, ordered lists, and revalidates the household", async () => {
    const recipe = await add({
      name: "  Arroz   con pollo ",
      mealTypes: ["dinner", "lunch", "dinner"],
      weekdays: [7, 1, 1],
      url: "https://example.com/arroz",
    });
    expect(recipe).toEqual({
      id: expect.any(String),
      name: "Arroz con pollo",
      mealTypes: ["lunch", "dinner"],
      weekdays: [1, 7],
      url: "https://example.com/arroz",
    });
    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).toContain("/household");
  });

  test("a link typed with an upper-case scheme is stored in lowercase (the CHECK is case-sensitive)", async () => {
    const recipe = await add({ name: "Sopa", url: "HTTPS://Example.com/sopa" });
    expect(recipe.url).toBe("https://Example.com/sopa");
    expect((await addRecipe({ name: "Otra", url: "https://e.co/a\u0000b" })).ok).toBe(false);
  });

  test("refuses a bad link, an unknown meal and a bad weekday before the database", async () => {
    for (const bad of [
      { name: "Sopa", url: "javascript:alert(1)" },
      { name: "Sopa", url: "https://user:pw@example.com" },
      { name: "Sopa", mealTypes: ["brunch"] },
      { name: "Sopa", weekdays: [0] },
      { name: "" },
    ]) {
      expect((await addRecipe(bad)).ok).toBe(false);
    }
    expect(await testDb.select().from(householdRecipes)).toHaveLength(0);
  });

  test("an edit replaces every field of that recipe only, and clears the link when it is emptied", async () => {
    const a = await add({
      name: "Sopa",
      mealTypes: ["dinner"],
      weekdays: [1],
      url: "https://e.co/a",
    });
    const b = await add({ name: "Ensalada" });
    const edited = await editRecipe({
      id: a.id,
      name: "Sopa de verduras",
      mealTypes: ["lunch"],
      weekdays: [2, 3],
      url: "",
    });
    expect(edited).toEqual({
      ok: true,
      data: {
        id: a.id,
        name: "Sopa de verduras",
        mealTypes: ["lunch"],
        weekdays: [2, 3],
        url: null,
      },
    });
    expect(await rowOf(b.id)).toMatchObject({ name: "Ensalada", mealTypes: [], url: null });
  });

  test("editing a missing or removed recipe says «ya no está» and writes nothing", async () => {
    const a = await add({ name: "Sopa" });
    await removeRecipe({ id: a.id });
    expect(await editRecipe({ id: a.id, name: "Otra" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("ya no está"),
    });
    expect((await rowOf(a.id)).name).toBe("Sopa");
    expect((await editRecipe({ id: "00000000-0000-4000-8000-0000000000ff", name: "X" })).ok).toBe(
      false,
    );
  });

  test("the list is by name, and only the live ones", async () => {
    await add({ name: "Tallarines" });
    const gone = await add({ name: "Avena" });
    await add({ name: "Pollo" });
    await removeRecipe({ id: gone.id });
    expect((await getRecipes()).map((recipe) => recipe.name)).toEqual(["Pollo", "Tallarines"]);
  });
});

describe("«Quitar» and its «Deshacer»", () => {
  test("it leaves the list and stays in the table; undo brings that recipe back; twice changes nothing", async () => {
    const a = await add({ name: "Sopa", url: "https://e.co/a" });
    expect(await removeRecipe({ id: a.id })).toMatchObject({ ok: true, data: { id: a.id } });
    expect(await getRecipes()).toEqual([]);
    expect((await rowOf(a.id)).deletedAt).not.toBeNull();
    // Removing it again finds nothing to remove.
    expect((await removeRecipe({ id: a.id })).ok).toBe(false);

    expect(await undoRemoveRecipe({ id: a.id })).toMatchObject({
      ok: true,
      data: { name: "Sopa", url: "https://e.co/a" },
    });
    expect((await getRecipes()).map((recipe) => recipe.id)).toEqual([a.id]);
    // A second «Deshacer» is not an error and doesn't duplicate anything.
    expect((await undoRemoveRecipe({ id: a.id })).ok).toBe(true);
    expect(await getRecipes()).toHaveLength(1);
    expect((await undoRemoveRecipe({ id: "00000000-0000-4000-8000-0000000000ff" })).ok).toBe(false);
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
    const a = await add({ name: "Del owner" });
    // Positive control: the owner reads.
    expect(await getRecipes()).toHaveLength(1);

    request.headers = await headers();
    await expect(getRecipes()).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    expect(await addRecipe({ name: "Intruso" })).toEqual(refused);
    expect(await editRecipe({ id: a.id, name: "Intruso" })).toEqual(refused);
    expect(await removeRecipe({ id: a.id })).toEqual(refused);
    expect(await undoRemoveRecipe({ id: a.id })).toEqual(refused);
    expect(
      (await testDb.select().from(householdRecipes)).map((row) => [row.name, row.deletedAt]),
    ).toEqual([["Del owner", null]]);
  });
});

describe("export", () => {
  test("every recipe is exported, removed ones included, with its lists and link", async () => {
    await add({ name: "Sopa", mealTypes: ["dinner"], weekdays: [1, 4], url: "https://e.co/s" });
    const gone = await add({ name: "Avena" });
    await removeRecipe({ id: gone.id });
    const data = await buildExport(testDb, new Date("2026-10-14T15:00:00Z"));
    const table = data.tables.household_recipes;
    expect(table.rowCount).toBe(2);
    expect(table.rows.map((row) => [row.name, row.deleted_at !== null]).toSorted()).toEqual(
      [
        ["Avena", true],
        ["Sopa", false],
      ].toSorted(),
    );
    expect(table.rows.find((row) => row.name === "Sopa")).toMatchObject({
      meal_types: ["dinner"],
      weekdays: [1, 4],
      url: "https://e.co/s",
    });
  });
});
