// Shared helpers for the habits specs.
import { and, eq, isNull } from "drizzle-orm";
import { expect, test as base, type Page } from "@playwright/test";
import { Client } from "pg";
import { createDb } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { habitLogs, habits } from "@/modules/habits/db/schema";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { limaDay } from "./projects";

/**
 * `test` for every habits spec. "Hoy" shows every active habit and its count ("N de M hoy"),
 * and the screenshots show the whole grid, so these tests can't share it with others running in
 * parallel: each one holds a Postgres advisory lock, on a connection of its own, for the whole
 * test, and starts from an empty "Hoy" (`clearHabits`).
 */
export const test = base.extend<{ habitsLock: void }>({
  habitsLock: [
    // Playwright requires the object pattern for the (unused) fixtures argument.
    async ({}, provide) => {
      const client = new Client({ connectionString: testDatabaseUrl() });
      await client.connect();
      await client.query("select pg_advisory_lock(hashtext('e2e_habits'))");
      await clearHabits();
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

/** Every visible habit out of "Hoy" (soft-deleted, like the app does): an empty grid. */
export function clearHabits() {
  return withDb((db) =>
    db.update(habits).set({ deletedAt: new Date() }).where(isNull(habits.deletedAt)),
  );
}

type NewHabit = {
  name: string;
  /** A seeded area's slug. */
  area?: string;
  /** Marked today. */
  done?: boolean;
  /** Logged on an earlier day (it "has logs": deleting it asks first). */
  loggedBefore?: boolean;
  sortOrder?: number;
};

/**
 * A daily yes/no habit straight in the database (started a week ago). Returns its id. "Today" is
 * Lima's by this process's clock; the server computes its own, so a run that crosses Lima's
 * midnight (05:00 UTC) can see a `done` habit as not done. Rerun it.
 */
export function insertHabit(habit: NewHabit): Promise<string> {
  return withDb(async (db) => {
    let lifeAreaId: string | null = null;
    if (habit.area) {
      const [area] = await db
        .select({ id: lifeAreas.id })
        .from(lifeAreas)
        .where(eq(lifeAreas.slug, habit.area));
      lifeAreaId = area.id;
    }
    const [row] = await db
      .insert(habits)
      .values({
        name: habit.name,
        lifeAreaId,
        measure: "check",
        frequency: "daily",
        startDate: limaDay(-7),
        sortOrder: habit.sortOrder ?? 1_000 + Math.floor(Math.random() * 1_000),
      })
      .returning({ id: habits.id });
    const days = [habit.done ? limaDay(0) : null, habit.loggedBefore ? limaDay(-1) : null];
    for (const day of days) {
      if (day) await db.insert(habitLogs).values({ habitId: row.id, day, quantity: 1, target: 1 });
    }
    return row.id;
  });
}

/** A habit as stored, with today's quantity (null without a log for today). */
export function readHabit(id: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select({ name: habits.name, deletedAt: habits.deletedAt })
      .from(habits)
      .where(eq(habits.id, id));
    const [today] = await db
      .select({ quantity: habitLogs.quantity })
      .from(habitLogs)
      .where(and(eq(habitLogs.habitId, id), eq(habitLogs.day, limaDay(0))));
    return { ...row, today: today?.quantity ?? null };
  });
}

/** A seeded area's id, by slug. */
export function areaIdOf(slug: string): Promise<string> {
  return withDb(async (db) => {
    const [area] = await db
      .select({ id: lifeAreas.id })
      .from(lifeAreas)
      .where(eq(lifeAreas.slug, slug));
    return area.id;
  });
}

/** The habit with this (unique) name, as stored; undefined if none. */
export function readHabitByName(name: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select({ id: habits.id, areaId: habits.lifeAreaId, deletedAt: habits.deletedAt })
      .from(habits)
      .where(eq(habits.name, name));
    return row;
  });
}

export const pads = (page: Page) => page.getByRole("list", { name: "Hábitos de hoy" });
/** A habit's pad (a toggle button named after the habit). */
export const pad = (page: Page, name: string) =>
  pads(page).getByRole("button", { name, exact: true });
export const habitsCount = (page: Page) => page.locator("[data-habits-count]");

/** Opens /habits and waits until it is hydrated (keys and clicks reach React). */
export async function openHabits(page: Page) {
  await page.goto("/habits");
  await expect(page.getByRole("heading", { level: 1, name: "Hábitos" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}
