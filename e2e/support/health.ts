// Shared helpers for the health spec (the module's one E2E, E4).
//
// "/" shows «Entreno» (an open session, or the linked habit due) and /health every routine and
// session, so the tests can't share them with others running in parallel: the spec's `test` is a
// `boardTest` (the habits lock, the exclusive tasks lock and the finance lock:
// e2e/support/today-tasks.ts) and starts and ends with no routines, sessions or settings at all.
// Nothing else in the suite creates them, so a board test of another spec never sees «Entreno»
// (no open session, no linked habit). The catalogue's 64 seeded exercises stay: `clearHealth`
// removes only the exercises a test created (`seed_key` null).
import { eq, inArray, isNull } from "drizzle-orm";
import { expect, type Page } from "@playwright/test";
import { createDb } from "@/lib/db";
import {
  healthExercises,
  healthRoutineExercises,
  healthRoutines,
  healthSessionExercises,
  healthSessions,
  healthSets,
  healthSettings,
} from "@/modules/health/db/schema";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { boardTest } from "./today-tasks";

async function withDb<T>(run: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  const db = createDb(testDatabaseUrl());
  try {
    return await run(db);
  } finally {
    await db.$client.end();
  }
}

/**
 * No sets, session exercises, sessions, routine items, routines or settings (in that order: their
 * foreign keys are RESTRICT), and no exercise a test created. The seeded catalogue stays.
 */
export function clearHealth() {
  return withDb(async (db) => {
    await db.delete(healthSets);
    await db.delete(healthSessionExercises);
    await db.delete(healthSessions);
    await db.delete(healthRoutineExercises);
    await db.delete(healthRoutines);
    await db.delete(healthSettings);
    await db.delete(healthExercises).where(isNull(healthExercises.seedKey));
  });
}

/** `test` of the spec: `boardTest` plus a clean slate of `health` before and after each test. */
export const test = boardTest.extend<{ healthData: void }>({
  healthData: [
    async ({ boardTasks }, provide) => {
      // Lock order: boardTest's locks first.
      void boardTasks;
      await clearHealth();
      try {
        await provide();
      } finally {
        // Also after a failed test; before the habits lock goes (the settings point at a habit).
        await clearHealth();
      }
    },
    { auto: true, timeout: 240_000 },
  ],
});

export { expect };

/** Seeded exercises by their `seed_key` (src/modules/health/seed.ts). */
export const SQUAT = { seedKey: "barbell_squat", name: "Sentadilla con barra" };
export const BENCH = { seedKey: "barbell_bench_press", name: "Press de banca con barra" };

/** A routine straight in the database with seeded exercises (3 × 8–12 each). Returns its id. */
export function insertRoutine(name: string, seedKeys: string[]): Promise<string> {
  return withDb(async (db) => {
    const exercises = await db
      .select({ id: healthExercises.id, seedKey: healthExercises.seedKey })
      .from(healthExercises)
      .where(inArray(healthExercises.seedKey, seedKeys));
    const position = (await db.select().from(healthRoutines)).length;
    const [routine] = await db
      .insert(healthRoutines)
      .values({ name, position })
      .returning({ id: healthRoutines.id });
    await db.insert(healthRoutineExercises).values(
      seedKeys.map((key, index) => ({
        routineId: routine.id,
        exerciseId: exercises.find((exercise) => exercise.seedKey === key)!.id,
        position: index,
        targetSets: 3,
        repsMin: 8,
        repsMax: 12,
      })),
    );
    return routine.id;
  });
}

/** An open session of a routine, started `minutesAgo` minutes ago (no exercises). */
export function insertOpenSession(routineId: string, minutesAgo = 5): Promise<string> {
  return withDb(async (db) => {
    const [row] = await db
      .insert(healthSessions)
      .values({ routineId, startedAt: new Date(Date.now() - minutesAgo * 60_000) })
      .returning({ id: healthSessions.id });
    return row.id;
  });
}

/** «Ajustes» straight in the database: the habit a finished session marks. */
export function linkHabit(habitId: string): Promise<void> {
  return withDb(async (db) => {
    await db
      .insert(healthSettings)
      .values({ id: 1, habitId })
      .onConflictDoUpdate({ target: healthSettings.id, set: { habitId } });
  });
}

/** The settings row as stored, or undefined without one. */
export function readSettings() {
  return withDb(async (db) => {
    const [row] = await db.select().from(healthSettings).where(eq(healthSettings.id, 1));
    return row;
  });
}

/** Every session as stored, the oldest first. */
export function readSessions() {
  return withDb((db) => db.select().from(healthSessions).orderBy(healthSessions.startedAt));
}

/** Opens /health and waits until it is hydrated (keys and clicks reach React). */
export async function openHealth(page: Page) {
  await page.goto("/health");
  await expect(page.getByRole("heading", { level: 1, name: "Entreno" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

/** Waits until a page that was navigated to by a click is hydrated. */
export async function hydrated(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}
