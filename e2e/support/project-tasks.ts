// Helpers for the specs of tasks in projects (T5).
import { asc, eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { createDb } from "@/lib/db";
import { projectMilestones } from "@/modules/projects/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { requireTodayTasksTag } from "./today-tasks";

type NewProjectTask = {
  title: string;
  /** Index of the project's milestone (in their order), if any. */
  milestone?: number;
  done?: boolean;
  next?: boolean;
};

/**
 * Tasks of a project of the calling test, straight in the database. Returns their ids. A done one
 * is done today: the test needs `@today-tasks` (a board test would park it, see today-tasks.ts).
 */
export async function insertProjectTasks(
  projectId: string,
  list: readonly NewProjectTask[],
): Promise<string[]> {
  for (const task of list) requireTodayTasksTag({ done: task.done });
  const db = createDb(testDatabaseUrl());
  try {
    const milestones = await db
      .select({ id: projectMilestones.id })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, projectId))
      .orderBy(asc(projectMilestones.sortOrder));
    const ids: string[] = [];
    for (const task of list) {
      const [row] = await db
        .insert(tasks)
        .values({
          title: task.title,
          projectId,
          milestoneId: task.milestone === undefined ? null : milestones[task.milestone].id,
          doneAt: task.done ? new Date() : null,
          isNextAction: task.next ?? false,
        })
        .returning({ id: tasks.id });
      ids.push(row.id);
    }
    return ids;
  } finally {
    await db.$client.end();
  }
}

/** Whether the task is its project's next action (read from the database). */
export async function isNextAction(id: string): Promise<boolean> {
  const db = createDb(testDatabaseUrl());
  try {
    const [row] = await db.select({ next: tasks.isNextAction }).from(tasks).where(eq(tasks.id, id));
    return row.next;
  } finally {
    await db.$client.end();
  }
}

export const tasksSection = (page: Page) => page.locator("[data-project-tasks]");
export const addTaskField = (page: Page) =>
  tasksSection(page).getByRole("textbox", { name: "Nueva tarea" });
export const nextFlag = (page: Page, title: string) =>
  tasksSection(page).getByRole("button", { name: `Próxima acción: ${title}`, exact: true });

/** Titles of the pending tasks of the section, in the order on screen. */
export async function sectionTitles(page: Page): Promise<string[]> {
  return tasksSection(page)
    .getByRole("list", { name: /^(Tareas pendientes del proyecto|Hito \d+|Sin hito)$/ })
    .getByRole("link")
    .allTextContents();
}

/** The group headings (h3) of the pending tasks, in order. */
export async function groupHeadings(page: Page): Promise<string[]> {
  return tasksSection(page).locator("[data-task-group]").allTextContents();
}
