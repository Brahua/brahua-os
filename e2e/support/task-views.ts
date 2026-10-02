// Fixtures and helpers for the views spec (T2 of `tasks`). Apart from tasks.ts so the specs of
// T2–T4, built in parallel, never edit the same file.
import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { createDb, type Database } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
import type { TaskPriority } from "@/modules/tasks/task-constants";
import { testDatabaseUrl } from "../../tests/integration/helpers";
import { limaDay } from "./projects";

/**
 * The project whose tasks the screenshots show (read only: no test edits them or adds tasks to
 * it). In "Trabajo", where no projects screenshot looks. Fixed ids, so the "Hoy" screenshot can
 * hide every other test's tasks (task-views-only.css). Due dates are days from Lima's today when
 * global-setup runs (a run that crosses Lima's midnight shifts the labels; rerun it).
 */
export const VIEWS_FIXTURE = {
  projectId: "7a5c0000-0000-4000-8000-000000000001",
  name: "Mudanza de oficina",
  areaSlug: "work",
  milestones: [
    { id: "7a5c0000-0000-4000-8000-000000000101", title: "Inventario" },
    { id: "7a5c0000-0000-4000-8000-000000000102", title: "Embalaje" },
  ],
  tasks: [
    {
      id: "7a5c0000-0000-4000-8000-000000000201",
      title: "Contratar la mudanza",
      due: -2,
      priority: "high",
    },
    { id: "7a5c0000-0000-4000-8000-000000000202", title: "Etiquetar las cajas", due: 0 },
    { id: "7a5c0000-0000-4000-8000-000000000203", title: "Desconectar los equipos", due: 2 },
    { id: "7a5c0000-0000-4000-8000-000000000204", title: "Devolver las llaves", priority: "low" },
  ] as { id: string; title: string; due?: number; priority?: TaskPriority }[],
} as const;

/** Inserts VIEWS_FIXTURE (global-setup, after the areas seed). */
export async function seedTaskViewsFixture(db: Database): Promise<void> {
  const [area] = await db
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, VIEWS_FIXTURE.areaSlug));
  await db.insert(projects).values({
    id: VIEWS_FIXTURE.projectId,
    name: VIEWS_FIXTURE.name,
    status: "active",
    lifeAreaId: area.id,
  });
  await db.insert(projectMilestones).values(
    VIEWS_FIXTURE.milestones.map((milestone, sortOrder) => ({
      ...milestone,
      projectId: VIEWS_FIXTURE.projectId,
      sortOrder,
    })),
  );
  await db.insert(tasks).values(
    VIEWS_FIXTURE.tasks.map((task, index) => ({
      id: task.id,
      title: task.title,
      priority: task.priority ?? "medium",
      dueDate: task.due === undefined ? null : limaDay(task.due),
      projectId: VIEWS_FIXTURE.projectId,
      // Created in this order (the last tie-breaker of the views).
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    })),
  );
}

type NewViewTask = {
  title: string;
  priority?: TaskPriority;
  /** Days from Lima's today. */
  due?: number;
  /** Done this many hours ago. */
  doneHoursAgo?: number;
  areaSlug?: string;
  projectId?: string;
  /** Minutes after an arbitrary base: orders ties by creation. */
  createdMinute?: number;
};

/** A task of the calling test, straight in the database. Returns its id. */
export async function insertViewTask(task: NewViewTask): Promise<string> {
  const db = createDb(testDatabaseUrl());
  try {
    const area = task.areaSlug
      ? (
          await db
            .select({ id: lifeAreas.id })
            .from(lifeAreas)
            .where(eq(lifeAreas.slug, task.areaSlug))
        )[0]
      : undefined;
    const [row] = await db
      .insert(tasks)
      .values({
        title: task.title,
        priority: task.priority ?? "medium",
        dueDate: task.due === undefined ? null : limaDay(task.due),
        doneAt:
          task.doneHoursAgo === undefined
            ? null
            : new Date(Date.now() - task.doneHoursAgo * 3_600_000),
        lifeAreaId: area?.id ?? null,
        projectId: task.projectId ?? null,
        ...(task.createdMinute === undefined
          ? {}
          : { createdAt: new Date(Date.UTC(2026, 0, 2, 0, task.createdMinute)) }),
      })
      .returning({ id: tasks.id });
    return row.id;
  } finally {
    await db.$client.end();
  }
}

/** A project of the calling test (in Hobbies) with milestones. Returns its id and theirs. */
export async function insertProjectWithMilestones(
  name: string,
  milestones: string[],
): Promise<{ id: string; milestones: string[] }> {
  const db = createDb(testDatabaseUrl());
  try {
    const [area] = await db
      .select({ id: lifeAreas.id })
      .from(lifeAreas)
      .where(eq(lifeAreas.slug, "hobbies"));
    const [project] = await db
      .insert(projects)
      .values({ name, status: "active", lifeAreaId: area.id })
      .returning({ id: projects.id });
    const rows = await db
      .insert(projectMilestones)
      .values(milestones.map((title, sortOrder) => ({ projectId: project.id, title, sortOrder })))
      .returning({ id: projectMilestones.id });
    return { id: project.id, milestones: rows.map((row) => row.id) };
  } finally {
    await db.$client.end();
  }
}

/** A task as stored (notes and milestone included). */
export async function readViewTask(id: string) {
  const db = createDb(testDatabaseUrl());
  try {
    const [row] = await db
      .select({ doneAt: tasks.doneAt, notes: tasks.notes, milestoneId: tasks.milestoneId })
      .from(tasks)
      .where(eq(tasks.id, id));
    return row;
  } finally {
    await db.$client.end();
  }
}

/** The list of a view by its name (e.g. "Tareas de hoy"). */
export const viewList = (page: Page, name: string) => page.getByRole("list", { name });

/** A row of any view, by its title. */
export const viewRow = (page: Page, title: string) =>
  page
    .locator("[data-task-row]")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });

/** The titles of the rows of `list` that are in `mine`, in the order shown. */
export async function ownTitles(page: Page, listName: string, mine: readonly string[]) {
  const titles = await viewList(page, listName).getByRole("link").allTextContents();
  return titles.filter((title) => mine.includes(title));
}
