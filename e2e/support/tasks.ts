// Shared helpers for the tasks specs.
import { eq } from "drizzle-orm";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { createDb } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
import type { TaskPriority } from "@/modules/tasks/task-constants";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { limaDay } from "./projects";

/** A task title no other test (or retry) uses: the inbox is shared by tests running in parallel. */
export function uniqueTitle(prefix: string, testInfo: TestInfo) {
  return `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 7)}`;
}

type NewTask = {
  title: string;
  priority?: TaskPriority;
  /** Days from Lima's today. */
  due?: number;
};

/** An inbox task of the calling test, straight in the database. Returns its id. */
export async function insertTask(task: NewTask): Promise<string> {
  const db = createDb(testDatabaseUrl());
  try {
    const [row] = await db
      .insert(tasks)
      .values({
        title: task.title,
        priority: task.priority ?? "medium",
        dueDate: task.due === undefined ? null : limaDay(task.due),
      })
      .returning({ id: tasks.id });
    return row.id;
  } finally {
    await db.$client.end();
  }
}

/** A task as stored, with its area's slug (or null). */
export async function readTask(id: string) {
  const db = createDb(testDatabaseUrl());
  try {
    const [row] = await db
      .select({
        title: tasks.title,
        doneAt: tasks.doneAt,
        deletedAt: tasks.deletedAt,
        dueDate: tasks.dueDate,
        priority: tasks.priority,
        areaSlug: lifeAreas.slug,
      })
      .from(tasks)
      .leftJoin(lifeAreas, eq(lifeAreas.id, tasks.lifeAreaId))
      .where(eq(tasks.id, id));
    return row;
  } finally {
    await db.$client.end();
  }
}

/** The task with this (unique) title, as stored, with its area's slug; undefined if none. */
export async function readTaskByTitle(title: string) {
  const db = createDb(testDatabaseUrl());
  try {
    const [row] = await db
      .select({ id: tasks.id, doneAt: tasks.doneAt, areaSlug: lifeAreas.slug })
      .from(tasks)
      .leftJoin(lifeAreas, eq(lifeAreas.id, tasks.lifeAreaId))
      .where(eq(tasks.title, title));
    return row;
  } finally {
    await db.$client.end();
  }
}

/** Opens a page and waits until the navigation is hydrated (keys and clicks reach React). */
export async function openReady(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole("heading", { level: 1 }).first().waitFor({ state: "visible" });
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

export const captureSheet = (page: Page) => page.getByRole("dialog", { name: "Nueva tarea" });
export const captureTitle = (page: Page) =>
  captureSheet(page).getByRole("textbox", { name: "¿Qué hay que hacer?" });
export const captureStatus = (page: Page) => captureSheet(page).locator("[data-capture-status]");
export const inbox = (page: Page) => page.getByRole("list", { name: "Tareas en la bandeja" });
/** A row of the inbox, by its title. */
export const taskRow = (page: Page, title: string) =>
  inbox(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
