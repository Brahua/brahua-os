// Shared helpers for the habits specs.
import { and, eq, isNull } from "drizzle-orm";
import { expect, test as base, type Page } from "@playwright/test";
import { Client } from "pg";
import { createDb } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
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
  /** H2: "X veces por semana" with this X. */
  weeklyTarget?: number;
  /** H2: fixed ISO days (1 = Monday … 7 = Sunday). */
  weekdays?: number[];
  /** H2: archived. */
  archived?: boolean;
  /** H3: a habit to avoid (`done` is then "a relapse today"). */
  kind?: "build" | "avoid";
  /** H3: a quantity habit ("8 vasos": goal, unit, step) and today's quantity. */
  quantity?: { goal: number; unit: string; step?: number; today?: number };
  /** H4: earlier days logged as done (days from today: -1 is yesterday), for a streak. */
  doneDays?: number[];
  /** H4: a pause, in days from today (both included). */
  pause?: { start: number; end: number; reason?: string };
  /** H4: started this many days ago (default 7). */
  startedDaysAgo?: number;
  /** H5: started on this day (YYYY-MM-DD; overrides `startedDaysAgo`), for fixed screenshots. */
  startDate?: string;
  /** H5: logs on fixed days (YYYY-MM-DD; the target is the goal). */
  logs?: { day: string; quantity?: number }[];
  /** H5: pauses on fixed days. */
  pauses?: { startDate: string; endDate: string; reason?: string }[];
  /** H5: "Más detalles". */
  identity?: string;
  cue?: string;
  /** R4: the reminder time (HH:MM, Lima) and the part of the day. */
  reminderTime?: string;
  daypart?: "morning" | "afternoon" | "evening";
};

/**
 * A yes/no habit straight in the database (started a week ago): daily, weekly (`weeklyTarget`) or
 * on fixed days (`weekdays`). Returns its id. "Today" is
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
    const { quantity } = habit;
    const [row] = await db
      .insert(habits)
      .values({
        name: habit.name,
        lifeAreaId,
        kind: habit.kind ?? "build",
        ...(quantity
          ? {
              measure: "quantity",
              goal: quantity.goal,
              unit: quantity.unit,
              step: quantity.step ?? 1,
            }
          : { measure: "check" }),
        frequency: habit.weeklyTarget ? "weekly_count" : habit.weekdays ? "weekdays" : "daily",
        weeklyTarget: habit.weeklyTarget ?? null,
        weekdays: habit.weekdays ?? null,
        archivedAt: habit.archived ? new Date() : null,
        startDate: habit.startDate ?? limaDay(-(habit.startedDaysAgo ?? 7)),
        identity: habit.identity ?? null,
        cue: habit.cue ?? null,
        reminderTime: habit.reminderTime ?? null,
        daypart: habit.daypart ?? null,
        sortOrder: habit.sortOrder ?? 1_000 + Math.floor(Math.random() * 1_000),
      })
      .returning({ id: habits.id });
    const target = quantity?.goal ?? 1;
    if (quantity?.today) {
      await db
        .insert(habitLogs)
        .values({ habitId: row.id, day: limaDay(0), quantity: quantity.today, target });
    }
    const days = [habit.done ? limaDay(0) : null, habit.loggedBefore ? limaDay(-1) : null];
    for (const day of days) {
      if (day) await db.insert(habitLogs).values({ habitId: row.id, day, quantity: 1, target });
    }
    for (const offset of habit.doneDays ?? []) {
      await db
        .insert(habitLogs)
        .values({ habitId: row.id, day: limaDay(offset), quantity: target, target });
    }
    for (const entry of habit.logs ?? []) {
      await db
        .insert(habitLogs)
        .values({ habitId: row.id, day: entry.day, quantity: entry.quantity ?? target, target });
    }
    for (const pause of habit.pauses ?? []) {
      await db.insert(habitPauses).values({ habitId: row.id, reason: null, ...pause });
    }
    if (habit.pause) {
      await db.insert(habitPauses).values({
        habitId: row.id,
        startDate: limaDay(habit.pause.start),
        endDate: limaDay(habit.pause.end),
        reason: habit.pause.reason ?? null,
      });
    }
    return row.id;
  });
}

/** Lima's ISO weekday `days` from today (1 = Monday … 7 = Sunday). */
export function limaWeekday(days = 0): number {
  const weekday = new Date(`${limaDay(days)}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The active habits' names in their manual order (as stored). */
export function activeHabitOrder() {
  return withDb(async (db) => {
    const rows = await db
      .select({ name: habits.name })
      .from(habits)
      .where(and(isNull(habits.deletedAt), isNull(habits.archivedAt)))
      .orderBy(habits.sortOrder, habits.id);
    return rows.map((row) => row.name);
  });
}

/** A habit as stored, with today's quantity (null without a log for today). */
export function readHabit(id: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select({
        name: habits.name,
        deletedAt: habits.deletedAt,
        archivedAt: habits.archivedAt,
        frequency: habits.frequency,
        weeklyTarget: habits.weeklyTarget,
        weekdays: habits.weekdays,
      })
      .from(habits)
      .where(eq(habits.id, id));
    const [today] = await db
      .select({ quantity: habitLogs.quantity })
      .from(habitLogs)
      .where(and(eq(habitLogs.habitId, id), eq(habitLogs.day, limaDay(0))));
    return { ...row, today: today?.quantity ?? null };
  });
}

/** H4: a habit's quantity on a day (days from today), or null without a log. */
export function readDay(id: string, offset: number) {
  return withDb(async (db) => {
    const [row] = await db
      .select({ quantity: habitLogs.quantity })
      .from(habitLogs)
      .where(and(eq(habitLogs.habitId, id), eq(habitLogs.day, limaDay(offset))));
    return row?.quantity ?? null;
  });
}

/** H4: a habit's pauses that aren't removed, as stored (days as YYYY-MM-DD). */
export function readPauses(id: string) {
  return withDb((db) =>
    db
      .select({ startDate: habitPauses.startDate, endDate: habitPauses.endDate })
      .from(habitPauses)
      .where(and(eq(habitPauses.habitId, id), isNull(habitPauses.deletedAt)))
      .orderBy(habitPauses.startDate),
  );
}

/** polish: a habit's pauses that aren't removed, with their reason ("Saltar hoy" says "Descanso"). */
export function readPausesWithReason(id: string) {
  return withDb((db) =>
    db
      .select({
        startDate: habitPauses.startDate,
        endDate: habitPauses.endDate,
        reason: habitPauses.reason,
      })
      .from(habitPauses)
      .where(and(eq(habitPauses.habitId, id), isNull(habitPauses.deletedAt)))
      .orderBy(habitPauses.startDate),
  );
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

/** How many habits (deleted ones too) carry this name: 1 after a create, never 2 after a double Enter. */
export function countHabitsByName(name: string) {
  return withDb(async (db) => {
    const rows = await db.select({ id: habits.id }).from(habits).where(eq(habits.name, name));
    return rows.length;
  });
}

/** The habit with this (unique) name, as stored; undefined if none. */
export function readHabitByName(name: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select({
        id: habits.id,
        areaId: habits.lifeAreaId,
        deletedAt: habits.deletedAt,
        frequency: habits.frequency,
        weeklyTarget: habits.weeklyTarget,
        weekdays: habits.weekdays,
        reminderTime: habits.reminderTime,
        daypart: habits.daypart,
      })
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
/** H2: the folded "No tocan hoy (N)" section's toggle, and its pads. */
export const notDueToggle = (page: Page) => page.getByRole("button", { name: /^No tocan hoy/ });
export const notDuePads = (page: Page) => page.locator('[data-habits-grid="not-due"]');

/** H5: opens "Semana" (a week: any day of it) and waits until it is hydrated. */
export async function openWeek(page: Page, week?: string) {
  await page.goto(`/habits?vista=semana${week ? `&semana=${week}` : ""}`);
  await expect(page.getByRole("heading", { level: 1, name: "Hábitos" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

/** H5: opens a habit's page (a month of its calendar) and waits until it is hydrated. */
export async function openHabitPage(page: Page, id: string, month?: string) {
  await page.goto(`/habits/${id}${month ? `?mes=${month}` : ""}`);
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

/** H5: a habit as stored, with its "Más detalles". */
export function readHabitDetails(id: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select({ identity: habits.identity, cue: habits.cue, startDate: habits.startDate })
      .from(habits)
      .where(eq(habits.id, id));
    return row;
  });
}

/** Opens /habits and waits until it is hydrated (keys and clicks reach React). */
export async function openHabits(page: Page) {
  await page.goto("/habits");
  await expect(page.getByRole("heading", { level: 1, name: "Hábitos" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}
