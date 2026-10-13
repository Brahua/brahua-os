// Shared helpers for the goals spec.
import { and, eq, isNull, sql } from "drizzle-orm";
import { expect, test as base, type Page } from "@playwright/test";
import { Client } from "pg";
import { createDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { goalEntries, goals } from "@/modules/goals/db/schema";
import { testDatabaseUrl } from "../../tests/integration/helpers";

/**
 * `test` for the goals specs. /goals shows every goal and the screenshot shows its rows, so these
 * tests can't share it with others running in parallel (desktop and mobile run at once): each one
 * holds a Postgres advisory lock, on a connection of its own, for the whole test, and starts from
 * an empty list (`clearGoals`).
 */
export const test = base.extend<{ goalsLock: void }>({
  goalsLock: [
    // Playwright requires the object pattern for the (unused) fixtures argument.
    async ({}, provide) => {
      const client = new Client({ connectionString: testDatabaseUrl() });
      await client.connect();
      await client.query("select pg_advisory_lock(hashtext('e2e_goals'))");
      await clearGoals();
      // Fixture teardown runs after a failed test too; ending the session releases the lock.
      await provide();
      await client.end();
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

/** Every visible goal out of /goals (soft-deleted, like the app does): an empty list. */
export function clearGoals() {
  return withDb((db) =>
    db.update(goals).set({ deletedAt: new Date() }).where(isNull(goals.deletedAt)),
  );
}

/** The current year in Lima, by this process's clock (the server uses its own: rerun at midnight). */
export const currentYear = () => Number(ownerDateKey(new Date()).slice(0, 4));

type NewGoal = {
  title: string;
  /** Default: the current year. */
  periodKind?: "year" | "quarter";
  /** Default: the current year; the quarter, 4 when it is a quarter. */
  year?: number;
  quarter?: number;
  target?: number;
  unit?: string;
  /** What its entries add up to. */
  sum?: number;
  status?: "active" | "achieved" | "archived";
  /** A seeded area's slug. */
  area?: string;
  position?: number;
};

/** A manual goal straight in the database, with one entry for its sum. Returns its id. */
export function insertGoal(goal: NewGoal): Promise<string> {
  return withDb(async (db) => {
    let areaId: string | null = null;
    if (goal.area) {
      const [area] = await db
        .select({ id: lifeAreas.id })
        .from(lifeAreas)
        .where(eq(lifeAreas.slug, goal.area));
      areaId = area.id;
    }
    const periodKind = goal.periodKind ?? "year";
    const [row] = await db
      .insert(goals)
      .values({
        title: goal.title,
        periodKind,
        year: goal.year ?? currentYear(),
        quarter: periodKind === "quarter" ? (goal.quarter ?? 4) : null,
        sourceKind: "manual",
        target: goal.target ?? 12,
        unit: goal.unit ?? "libros",
        areaId,
        status: goal.status ?? "active",
        achievedAt: goal.status === "achieved" ? new Date() : null,
        position:
          goal.position ??
          (
            await db
              .select({
                next: sql<number>`coalesce(max(${goals.position}) + 1, 0)`.mapWith(Number),
              })
              .from(goals)
          )[0].next,
      })
      .returning({ id: goals.id });
    if (goal.sum) {
      await db
        .insert(goalEntries)
        .values({ goalId: row.id, delta: goal.sum, entryDate: ownerDateKey(new Date()) });
    }
    return row.id;
  });
}

/** A goal as stored, by title: its status, the sum of its live entries and how many were undone. */
export function readGoalByTitle(title: string) {
  return withDb(async (db) => {
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.title, title), isNull(goals.deletedAt)));
    if (!goal) return undefined;
    const entries = await db.select().from(goalEntries).where(eq(goalEntries.goalId, goal.id));
    return {
      id: goal.id,
      status: goal.status,
      target: goal.target,
      unit: goal.unit,
      sum: entries.filter((entry) => entry.deletedAt === null).reduce((s, e) => s + e.delta, 0),
      live: entries.filter((entry) => entry.deletedAt === null).length,
      undone: entries.filter((entry) => entry.deletedAt !== null).length,
    };
  });
}

/** Opens /goals and waits until it is hydrated (AppNav sets the marker in the same commit). */
export async function openGoals(page: Page) {
  await page.goto("/goals");
  await expect(page.getByRole("heading", { level: 1, name: "Metas" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

/** The row of a goal (its link's list item). */
export const goalRow = (page: Page, title: string) =>
  page.getByRole("link", { name: title }).locator("xpath=ancestor::li[1]");
