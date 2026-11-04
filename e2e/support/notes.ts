// Shared helpers for the notes spec (the module's one E2E, N4).
//
// /notes lists EVERY note and a day has ONE daily note (the partial unique index), so the notes
// tests can't share them with each other (desktop and mobile run in parallel, and `fullyParallel`
// spreads a file's tests over workers): every test holds the notes lock (an exclusive advisory lock
// on a connection of its own, for the whole test) and starts and ends with no notes at all. Nothing
// else in the suite writes notes. The spec's `test` extends `tasksTest`: the test that completes a
// task through a note's checkbox carries `@today-tasks` (its shared tasks lock is taken FIRST, so a
// board test, which never takes the notes lock, can't deadlock with it).
import { and, eq, isNull, like } from "drizzle-orm";
import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { createDb } from "@/lib/db";
import { notes } from "@/modules/notes/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { tasksTest } from "./today-tasks";

/** Tasks the spec makes from a note line start with it, so the teardown finds them. */
export const QA_TASK_PREFIX = "[QA] ";

async function withDb<T>(run: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  const db = createDb(testDatabaseUrl());
  try {
    return await run(db);
  } finally {
    await db.$client.end();
  }
}

/** No notes at all, and the spec's tasks soft-deleted (nothing references a note). */
export function clearNotes() {
  return withDb(async (db) => {
    await db.delete(notes);
    await db
      .update(tasks)
      .set({ deletedAt: new Date() })
      .where(and(like(tasks.title, `${QA_TASK_PREFIX}%`), isNull(tasks.deletedAt)));
  });
}

/** `test` of the spec: the notes lock and a clean slate of notes before and after each test. */
export const test = tasksTest.extend<{ notesData: void }>({
  notesData: [
    async ({ todayTasksLock }, provide) => {
      // Lock order: the (shared) tasks lock first, when the test is tagged.
      void todayTasksLock;
      const client = new Client({ connectionString: testDatabaseUrl() });
      await client.connect();
      try {
        await client.query("select pg_advisory_lock(hashtext('e2e_notes'))");
        await clearNotes();
        try {
          await provide();
        } finally {
          // Also after a failed test.
          await clearNotes();
        }
      } finally {
        // Ending the session releases the lock.
        await client.end();
      }
    },
    // Waiting for the lock is not the test's time.
    { auto: true, timeout: 240_000 },
  ],
});

export { expect };

/** A knowledge note straight in the database. Returns its id. */
export function insertPageNote(title: string, body: string): Promise<string> {
  return withDb(async (db) => {
    const [row] = await db
      .insert(notes)
      .values({ kind: "page", title, body })
      .returning({ id: notes.id });
    return row.id;
  });
}

/** A daily note straight in the database. Returns its id. */
export function insertDailyNote(day: string, body: string): Promise<string> {
  return withDb(async (db) => {
    const [row] = await db
      .insert(notes)
      .values({ kind: "daily", day, body })
      .returning({ id: notes.id });
    return row.id;
  });
}

/** A day's live note as stored, or undefined. */
export function readDailyNote(day: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.kind, "daily"), eq(notes.day, day), isNull(notes.deletedAt)));
    return row;
  });
}

/** A live task as stored, by title (a retry's earlier one is soft-deleted by the teardown). */
export function readTask(title: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.title, title), isNull(tasks.deletedAt)));
    return row;
  });
}

/** Opens a notes page and waits until it is hydrated (keys and clicks reach React). */
export async function openNotes(page: Page, path = "/notes") {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

/** The autosave said «Guardado» (the indicator is visual only: its data attribute). */
export async function untilNoteSaved(page: Page) {
  await expect(page.locator('[data-note-save-status="saved"]')).toBeVisible();
}
