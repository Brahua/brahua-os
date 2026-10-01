// Shared helpers and fixtures for the projects specs.
import { eq } from "drizzle-orm";
import type { Page, TestInfo } from "@playwright/test";
import type { Database } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { projects } from "@/modules/projects/db/schema";
import type { ProjectPriority, ProjectStatus } from "@/modules/projects/project-constants";

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
  /** Days from Lima's today (negative: in the past). */
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

/** Inserts the fixture projects (global-setup, after the areas seed). */
export async function seedProjects(db: Database): Promise<void> {
  const [area] = await db
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, FIXTURE_AREA.slug));
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

export const isDesktop = (testInfo: TestInfo) => testInfo.project.name === "desktop";

/** A name no other test (or retry) uses. */
export function uniqueName(prefix: string, testInfo: TestInfo) {
  return `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 7)}`;
}

export async function openProjects(page: Page, search = "") {
  await page.goto(`/projects${search}`);
  await page.getByRole("heading", { level: 1, name: "Proyectos" }).waitFor({ state: "visible" });
}

export const filter = (page: Page) => page.getByRole("navigation", { name: "Filtrar por área" });
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
