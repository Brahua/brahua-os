// Shared helpers for the learning spec (the module's one E2E, L3).
//
// "/" shows EVERY track in progress («Estudio») and /learning every track, so the tests can't share
// them with others running in parallel: the spec's `test` is a `boardTest` (the habits lock, the
// exclusive tasks lock and the finance lock: e2e/support/today-tasks.ts; it also keeps the board
// free of other specs' tasks) and starts and ends with no tracks, steps or sessions at all. Nothing
// else in the suite creates tracks, so a board test of another spec never sees one either. The
// projects it links to are made with `insertTodayProject` (soft-deleted by `boardTest` at the end,
// after the tracks that point at them are gone).
import { eq } from "drizzle-orm";
import { expect, type Page } from "@playwright/test";
import { createDb } from "@/lib/db";
import { learningSessions, learningSteps, learningTracks } from "@/modules/learning/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { boardTest, insertTodayProject } from "./today-tasks";

async function withDb<T>(run: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  const db = createDb(testDatabaseUrl());
  try {
    return await run(db);
  } finally {
    await db.$client.end();
  }
}

/** No sessions, steps or tracks (in that order: their foreign keys are RESTRICT). */
export function clearLearning() {
  return withDb(async (db) => {
    await db.delete(learningSessions);
    await db.delete(learningSteps);
    await db.delete(learningTracks);
  });
}

/** `test` of the spec: `boardTest` plus a clean slate of `learning` before and after each test. */
export const test = boardTest.extend<{ learningData: void }>({
  learningData: [
    async ({ boardTasks }, provide) => {
      // Lock order: boardTest's locks first.
      void boardTasks;
      await clearLearning();
      try {
        await provide();
      } finally {
        // Also after a failed test; before boardTest soft-deletes the projects they point at.
        await clearLearning();
      }
    },
    { auto: true, timeout: 240_000 },
  ],
});

export { expect, insertTodayProject };

type NewTrack = {
  title: string;
  kind?: "certification" | "course" | "book" | "practice";
  status?: "active" | "waiting";
  steps?: string[];
  /** How many of the first steps are done. */
  done?: number;
  weeklyTargetMinutes?: number;
  projectId?: string;
};

/** A track straight in the database, with its syllabus. Returns its id. */
export function insertTrack(track: NewTrack): Promise<string> {
  return withDb(async (db) => {
    const status = track.status ?? "active";
    const position = (
      await db.select().from(learningTracks).where(eq(learningTracks.status, status))
    ).length;
    const [row] = await db
      .insert(learningTracks)
      .values({
        title: track.title,
        kind: track.kind ?? "course",
        status,
        position,
        weeklyTargetMinutes: track.weeklyTargetMinutes ?? null,
        projectId: track.projectId ?? null,
      })
      .returning({ id: learningTracks.id });
    const steps = track.steps ?? [];
    if (steps.length > 0) {
      await db.insert(learningSteps).values(
        steps.map((title, index) => ({
          trackId: row.id,
          title,
          position: index,
          doneAt: index < (track.done ?? 0) ? new Date() : null,
        })),
      );
    }
    return row.id;
  });
}

/** Two tasks of a project, one done two days ago (never «Día completo» today) and one open. */
export function insertProjectTasks(projectId: string): Promise<void> {
  return withDb(async (db) => {
    await db.insert(tasks).values([
      {
        title: "Leer la guía del examen",
        projectId,
        doneAt: new Date(Date.now() - 2 * 86_400_000),
      },
      { title: "Agendar el examen", projectId },
    ]);
  });
}

/** The sessions of a track as stored (ended or running). */
export function readSessions(trackId: string) {
  return withDb((db) =>
    db.select().from(learningSessions).where(eq(learningSessions.trackId, trackId)),
  );
}

/** The track as stored, by title. */
export function readTrack(title: string) {
  return withDb(async (db) => {
    const [row] = await db.select().from(learningTracks).where(eq(learningTracks.title, title));
    return row;
  });
}

/** Opens /learning and waits until it is hydrated (keys and clicks reach React). */
export async function openLearning(page: Page) {
  await page.goto("/learning");
  await expect(page.getByRole("heading", { level: 1, name: "Aprendizaje" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

/** Opens Hoy and waits until it is hydrated. */
export async function openToday(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}
