// Helpers of the tags specs (T4). Tags are global: each test uses its own names (uniqueTag).
import { eq, inArray } from "drizzle-orm";
import type { TestInfo } from "@playwright/test";
import { createDb } from "@/lib/db";
import { taskTagLinks, taskTags } from "@/modules/tasks/db/schema";
import { testDatabaseUrl } from "../../tests/integration/helpers";

/** A tag name no other test (or retry) uses, lowercase and short (≤ 30). */
export function uniqueTag(prefix: string, testInfo: TestInfo) {
  const device = testInfo.project.name === "desktop" ? "d" : "m";
  return `${prefix}-${device}${Math.random().toString(36).slice(2, 7)}`;
}

/** Tags a task straight in the database (creating the tags). */
export async function tagTask(taskId: string, names: string[]) {
  const db = createDb(testDatabaseUrl());
  try {
    await db
      .insert(taskTags)
      .values(names.map((name) => ({ name })))
      .onConflictDoNothing();
    const rows = await db
      .select({ id: taskTags.id })
      .from(taskTags)
      .where(inArray(taskTags.name, names));
    await db.insert(taskTagLinks).values(rows.map((row) => ({ taskId, tagId: row.id })));
  } finally {
    await db.$client.end();
  }
}

/** The names of a task's tags as stored, sorted. */
export async function readTaskTags(taskId: string): Promise<string[]> {
  const db = createDb(testDatabaseUrl());
  try {
    const rows = await db
      .select({ name: taskTags.name })
      .from(taskTagLinks)
      .innerJoin(taskTags, eq(taskTags.id, taskTagLinks.tagId))
      .where(eq(taskTagLinks.taskId, taskId))
      .orderBy(taskTags.name);
    return rows.map((row) => row.name);
  } finally {
    await db.$client.end();
  }
}

/** The id of a tag by name. */
export async function readTagId(name: string): Promise<string> {
  const db = createDb(testDatabaseUrl());
  try {
    const [row] = await db
      .select({ id: taskTags.id })
      .from(taskTags)
      .where(eq(taskTags.name, name));
    return row.id;
  } finally {
    await db.$client.end();
  }
}
