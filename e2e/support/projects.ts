// Shared helpers and fixtures for the projects specs.
import { eq } from "drizzle-orm";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { createDb, type Database } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { projects } from "@/modules/projects/db/schema";
import type { ProjectPriority, ProjectStatus } from "@/modules/projects/project-constants";
import { testDatabaseUrl } from "../../tests/integration/helpers";

/**
 * The area whose projects the specs (and the screenshots) look at through `?area=travel`. Only
 * global-setup puts projects in it; tests that create projects use another area, so this view
 * never changes while other tests run in parallel.
 */
export const FIXTURE_AREA = { slug: "travel", name: "Planes y Viajes" };

/** The area tests create their projects in (with unique names). */
export const CREATE_AREA = { slug: "hobbies", name: "Hobbies" };

type Fixture = {
  name: string;
  status: ProjectStatus;
  priority?: ProjectPriority;
  /**
   * Days from Lima's today (negative: in the past), fixed when global-setup runs. The labels are
   * computed on the server with its real clock (page.clock can't reach it), so a run that
   * crosses Lima midnight (05:00 UTC) between setup and a test would see every label shift by a
   * day and fail; rerun it. A run takes minutes, so it only bites a run started just before then.
   */
  due?: number;
  objective?: string;
};

/** In the order the list shows them (groups, then priority, due date and name). */
export const FIXTURE_PROJECTS: readonly Fixture[] = [
  {
    name: "Viaje a Cusco",
    status: "active",
    priority: "high",
    due: 0,
    objective: "Pasajes, hotel y entradas a Machu Picchu comprados.",
  },
  { name: "Renovar pasaporte", status: "active", due: 3 },
  { name: "Mapa de viajes", status: "maintenance", due: -10 },
  { name: "Ruta por Europa", status: "paused", due: -2 },
  { name: "Camino Inca", status: "idea", priority: "low" },
  { name: "Viaje a Arequipa", status: "done" },
  { name: "Crucero", status: "canceled" },
];

/** Lima's calendar day `days` away from today, as YYYY-MM-DD. */
export function limaDay(days: number, now = new Date()): string {
  const [year, month, day] = ownerDateKey(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The project whose page the detail screenshots show (read only: no test edits it). In "Hogar",
 * so it never shows in the list screenshots (`?area=travel`), and with fixed dates, so the page
 * looks the same every day (the end is far enough to never show a due notice).
 */
export const DETAIL_FIXTURE = {
  name: "Remodelar la cocina",
  areaSlug: "home",
  areaName: "Hogar",
  status: "active",
  priority: "high",
  objective: "Muebles nuevos, encimera de cuarzo y luz bajo los muebles altos.",
  startDate: "2026-01-12",
  dueDate: "2030-06-28",
} as const;

async function areaIdOf(db: Database, slug: string): Promise<string> {
  const [area] = await db
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, slug));
  return area.id;
}

/** Inserts the fixture projects (global-setup, after the areas seed). */
export async function seedProjects(db: Database): Promise<void> {
  const area = { id: await areaIdOf(db, FIXTURE_AREA.slug) };
  const detail = DETAIL_FIXTURE;
  await db.insert(projects).values({
    name: detail.name,
    status: detail.status,
    priority: detail.priority,
    objective: detail.objective,
    startDate: detail.startDate,
    dueDate: detail.dueDate,
    lifeAreaId: await areaIdOf(db, detail.areaSlug),
  });
  await db.insert(projects).values(
    FIXTURE_PROJECTS.map((fixture) => ({
      name: fixture.name,
      status: fixture.status,
      priority: fixture.priority ?? "medium",
      objective: fixture.objective ?? null,
      lifeAreaId: area.id,
      dueDate: fixture.due === undefined ? null : limaDay(fixture.due),
      completedAt: fixture.status === "done" ? new Date() : null,
    })),
  );
}

type NewProject = {
  name: string;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  /** Days from Lima's today. */
  due?: number;
};

/**
 * A project of the calling test, straight in the database (in "Hobbies", like the tests that
 * create from the sheet), so tests that edit or delete never touch the fixtures. Returns its id.
 */
export async function insertProject(project: NewProject): Promise<string> {
  const db = createDb(testDatabaseUrl());
  try {
    const status = project.status ?? "active";
    const [row] = await db
      .insert(projects)
      .values({
        name: project.name,
        status,
        priority: project.priority ?? "medium",
        lifeAreaId: await areaIdOf(db, CREATE_AREA.slug),
        dueDate: project.due === undefined ? null : limaDay(project.due),
        completedAt: status === "done" ? new Date() : null,
      })
      .returning({ id: projects.id });
    return row.id;
  } finally {
    await db.$client.end();
  }
}

/** Opens a project's page and waits until it is hydrated (see openProjects). */
export async function openProject(page: Page, id: string) {
  await page.goto(`/projects/${id}`);
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible" });
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

/**
 * Runs `action` and waits for the Server Action's response: the page changes before it
 * (optimistic), so a reload right after could read the old value.
 */
export async function untilSaved(page: Page, action: () => Promise<unknown>) {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.request().headers()["next-action"] !== undefined,
    ),
    action(),
  ]);
}

export const notices = (page: Page) => page.getByRole("region", { name: "Avisos" });

export const isDesktop = (testInfo: TestInfo) => testInfo.project.name === "desktop";

/** A name no other test (or retry) uses. */
export function uniqueName(prefix: string, testInfo: TestInfo) {
  return `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Opens the list and waits until it is hydrated (AppNav sets the marker in the same commit as
 * the page, which has no Suspense boundaries), so clicks and keys reach React's handlers.
 */
export async function openProjects(page: Page, search = "") {
  await page.goto(`/projects${search}`);
  await page.getByRole("heading", { level: 1, name: "Proyectos" }).waitFor({ state: "visible" });
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

/**
 * The "Área: …" key of the list (its name says the area on: "Filtrar por área: Todas"). Found even
 * while its sheet is open, when the modal leaves the rest of the page aria-hidden.
 */
export const filterTrigger = (page: Page) =>
  page.getByRole("button", { name: /^Filtrar por área:/, includeHidden: true });
export const filterSheet = (page: Page) => page.getByRole("dialog", { name: "Filtrar por área" });

/** Opens the area filter and follows the option `name` ("Todas las áreas" or an area). */
export async function pickArea(page: Page, name: string) {
  await filterTrigger(page).click();
  await filterSheet(page).getByRole("link", { name, exact: true }).click();
  await expect(filterSheet(page)).toBeHidden();
}
export const newProjectButton = (page: Page) =>
  page.getByRole("button", { name: "Nuevo proyecto" });
export const sheet = (page: Page) => page.getByRole("dialog");
export const nameField = (page: Page) => sheet(page).getByRole("textbox", { name: "Nombre" });
export const areaGroup = (page: Page) => sheet(page).getByRole("radiogroup", { name: "Área" });
export const statusGroup = (page: Page) => sheet(page).getByRole("radiogroup", { name: "Estado" });
export const historyToggle = (page: Page) => page.getByRole("button", { name: /^Historial/ });
export const groupList = (page: Page, status: string) =>
  page.getByRole("list", { name: `Proyectos: ${status}` });

/** Names of the cards in a group, in the order on screen. */
export async function cardNames(page: Page, status: string): Promise<string[]> {
  return groupList(page, status)
    .getByRole("heading")
    .evaluateAll((headings) => headings.map((heading) => heading.textContent ?? ""));
}
