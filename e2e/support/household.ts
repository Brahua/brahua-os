// Shared helpers for the household spec (the module's one E2E).
//
// /household shows EVERY product, EVERY recipe and every pending task tagged `limpieza`, and the
// screenshot shows their rows, so these tests can't share them with others running in parallel
// (desktop and mobile run at once): each one holds a Postgres advisory lock, on a connection of its
// own, for the whole test, and starts (and ends) with nothing of the household. The cleaning is made
// of tasks due today, so the tests that create or complete one carry `@today-tasks` (the shared
// tasks lock, e2e/support/today-tasks.ts): a board test would park them under the test.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { createDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { householdProducts, householdRecipes } from "@/modules/household/db/schema";
import type { MealType } from "@/modules/household/recipe-constants";
import type { ProductCategory } from "@/modules/household/shopping-constants";
import { productKey } from "@/modules/household/shopping-constants";
import { taskTagLinks, taskTags, tasks } from "@/modules/tasks/db/schema";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { tasksTest } from "./today-tasks";

export const test = tasksTest.extend<{ householdLock: void }>({
  householdLock: [
    // Playwright requires the object pattern for the (unused) fixtures argument.
    async ({}, provide) => {
      const client = new Client({ connectionString: testDatabaseUrl() });
      await client.connect();
      await client.query("select pg_advisory_lock(hashtext('e2e_household'))");
      await clearHousehold();
      try {
        await provide();
      } finally {
        // Also after a failed test: the next one (or another spec's board) starts clean.
        await clearHousehold();
        // Ending the session releases the lock.
        await client.end();
      }
    },
    // Waiting for the lock is not the test's time.
    { auto: true, timeout: 240_000 },
  ],
});

export { expect };

async function withDb<T>(run: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  const db = createDb(testDatabaseUrl());
  try {
    return await run(db);
  } finally {
    await db.$client.end();
  }
}

/** The ids of the tasks tagged `limpieza` (whatever their state). */
async function cleaningTaskIds(db: ReturnType<typeof createDb>): Promise<string[]> {
  const rows = await db
    .select({ id: taskTagLinks.taskId })
    .from(taskTagLinks)
    .innerJoin(taskTags, eq(taskTags.id, taskTagLinks.tagId))
    .where(eq(taskTags.name, "limpieza"));
  return rows.map((row) => row.id);
}

/** No products, no recipes and no cleaning task: what a test of the household starts from. */
export function clearHousehold() {
  return withDb(async (db) => {
    await db.delete(householdProducts);
    await db.delete(householdRecipes);
    const ids = await cleaningTaskIds(db);
    if (ids.length > 0) await db.delete(tasks).where(inArray(tasks.id, ids));
  });
}

type NewProduct = {
  name: string;
  category?: ProductCategory;
  quantity?: string;
  status?: "idle" | "needed" | "bought";
};

/** A product straight in the database. */
export function insertProduct(product: NewProduct): Promise<string> {
  return withDb(async (db) => {
    const status = product.status ?? "needed";
    const [row] = await db
      .insert(householdProducts)
      .values({
        name: product.name,
        nameKey: productKey(product.name),
        category: product.category ?? "otros",
        quantity: product.quantity ?? null,
        status,
        boughtAt: status === "bought" ? new Date() : null,
      })
      .returning({ id: householdProducts.id });
    return row.id;
  });
}

/** A product as stored, by name (live ones). */
export function readProduct(name: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select()
      .from(householdProducts)
      .where(
        and(eq(householdProducts.nameKey, productKey(name)), isNull(householdProducts.deletedAt)),
      );
    return row;
  });
}

type NewRecipe = { name: string; mealTypes?: MealType[]; weekdays?: number[]; url?: string };

/** A recipe straight in the database. */
export function insertRecipe(recipe: NewRecipe): Promise<string> {
  return withDb(async (db) => {
    const [row] = await db
      .insert(householdRecipes)
      .values({
        name: recipe.name,
        mealTypes: recipe.mealTypes ?? [],
        weekdays: recipe.weekdays ?? [],
        url: recipe.url ?? null,
      })
      .returning({ id: householdRecipes.id });
    return row.id;
  });
}

/** A recipe as stored, by name (live ones). */
export function readRecipe(name: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select()
      .from(householdRecipes)
      .where(and(eq(householdRecipes.name, name), isNull(householdRecipes.deletedAt)));
    return row;
  });
}

/**
 * A daily cleaning straight in the database: a pending task tagged `limpieza` and with its zone,
 * due `due` days from today (Lima). The test that uses it carries `@today-tasks`.
 */
export function insertCleaning(title: string, zone: string, due = 0): Promise<string> {
  return withDb(async (db) => {
    const day = new Date(`${ownerDateKey(new Date())}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + due);
    const [task] = await db
      .insert(tasks)
      .values({
        title,
        dueDate: day.toISOString().slice(0, 10),
        recurrenceKind: "every_days",
        recurrenceInterval: 1,
      })
      .returning({ id: tasks.id });
    for (const name of ["limpieza", `zona: ${zone}`]) {
      await db.insert(taskTags).values({ name }).onConflictDoNothing({ target: taskTags.name });
      const [tag] = await db
        .select({ id: taskTags.id })
        .from(taskTags)
        .where(eq(taskTags.name, name));
      await db.insert(taskTagLinks).values({ taskId: task.id, tagId: tag.id });
    }
    return task.id;
  });
}

/** The cleaning tasks as stored: pending and done, with their tags and due date, by title. */
export function readCleaning(title: string) {
  return withDb(async (db) => {
    const rows = await db
      .select({
        id: tasks.id,
        dueDate: tasks.dueDate,
        doneAt: tasks.doneAt,
        deletedAt: tasks.deletedAt,
        // Qualified by hand: Drizzle prints a single-table column without its table, and a bare
        // "id" would read the tag's own inside the subquery.
        tags: sql<string[]>`coalesce((
          select array_agg(t.name order by t.name) from task_tag_links l
          join task_tags t on t.id = l.tag_id where l.task_id = "tasks"."id"), '{}')`,
      })
      .from(tasks)
      .where(eq(tasks.title, title));
    return rows;
  });
}

/** Opens a view of /household and waits until it is hydrated (keys and clicks reach React). */
export async function openHousehold(
  page: Page,
  view: "limpieza" | "compras" | "recetas" = "limpieza",
  extra = "",
) {
  const params = new URLSearchParams(view === "limpieza" ? {} : { vista: view });
  const query = [params.toString(), extra].filter(Boolean).join("&");
  await page.goto(`/household${query ? `?${query}` : ""}`);
  await expect(page.getByRole("heading", { level: 1, name: "Hogar" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}
