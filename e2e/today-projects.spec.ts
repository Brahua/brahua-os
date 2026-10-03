import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { projectDependencies, projects } from "@/modules/projects/db/schema";
import { testDatabaseUrl } from "../tests/integration/helpers";
import { fontsLoaded } from "./support/fonts";
import { expectNoOverflow, insertProject, isDesktop, uniqueName } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";
import { boardTest as test } from "./support/today-tasks";

// D3 of `today` (SPEC-today "Proyectos"): the projects due within a week and the blocked ones,
// last on "/", read only, each row a link to its project.
//
// The fixture projects ("Planes y Viajes", global-setup) are due today, in 3 days and 2 days ago,
// so "/" always has this section in the E2E database. Tests here add their own projects (in
// "Hobbies", with unique names) and soft-delete them at the end, so "/" doesn't keep growing for
// the specs running in parallel; the screenshot only shows the fixture rows. Every test is a
// `boardTest` (e2e/support/today-tasks.ts), like the other tests that look at "/": the habits and
// tasks locks, with the tasks due today parked, so the page above the section stays short.

const THEMES = ["dark", "light"] as const;
const FIXTURE_ROWS_CSS = path.join(__dirname, "support/today-projects-only.css");

const section = (page: Page) => page.getByRole("region", { name: "Proyectos" });
const rows = (page: Page) =>
  section(page).getByRole("list", { name: "Proyectos que vencen pronto o están bloqueados" });
const row = (page: Page, name: string) =>
  rows(page)
    .locator("li")
    .filter({ has: page.getByRole("link", { name, exact: true }) });

/** Opens "/" and waits until it is hydrated and laid out (fonts in). */
async function openToday(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle("Hoy · brahua-os");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

async function withDb<T>(run: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  const db = createDb(testDatabaseUrl());
  try {
    return await run(db);
  } finally {
    await db.$client.end();
  }
}

/** `projectId` waits for `blockedById` (P4), straight in the database. */
function block(projectId: string, blockedById: string) {
  return withDb((db) => db.insert(projectDependencies).values({ projectId, blockedById }));
}

/** The test's projects out of every view (soft-deleted, like the app does). */
const created: string[] = [];
test.afterEach(async () => {
  if (created.length === 0) return;
  const ids = created.splice(0);
  await withDb((db) =>
    db.update(projects).set({ deletedAt: new Date() }).where(inArray(projects.id, ids)),
  );
});

async function project(values: Parameters<typeof insertProject>[0]) {
  const id = await insertProject(values);
  created.push(id);
  return id;
}

test("a project due in 3 days and a blocked one show on Hoy, each a link", async ({
  page,
}, testInfo) => {
  const due = uniqueName("Renovar la licencia", testInfo);
  const blocker = uniqueName("Ahorrar", testInfo);
  const other = uniqueName("Elegir el local", testInfo);
  const blocked = uniqueName("Boda", testInfo);
  const dueId = await project({ name: due, due: 3 });
  // Neither blocker is due nor blocked: they don't show up themselves.
  const blockerId = await project({ name: blocker });
  const otherId = await project({ name: other, due: 30 });
  const blockedId = await project({ name: blocked });
  await block(blockedId, blockerId);
  await block(blockedId, otherId);
  await openToday(page);

  // Last on the board.
  await expect(page.locator("[data-today-board] > section").last()).toHaveAttribute(
    "data-today-section",
    "projects",
  );
  await expect(section(page).getByRole("heading", { level: 2, name: "Proyectos" })).toBeVisible();

  await expect(row(page, due)).toContainText("Hobbies");
  await expect(row(page, due)).toContainText("Vence en 3 días");
  await expect(row(page, due)).not.toContainText("Bloqueado");
  await expect(row(page, blocked)).toContainText(`Bloqueado por ${blocker}, ${other}`);
  await expect(row(page, blocker)).toHaveCount(0);
  await expect(row(page, other)).toHaveCount(0);
  // The link says it in words.
  await expect(
    rows(page).getByRole("link", { name: blocked, exact: true }),
  ).toHaveAccessibleDescription(`Hobbies, Bloqueado por ${blocker}, ${other}`);

  await rows(page).getByRole("link", { name: due, exact: true }).click();
  await expect(page).toHaveURL(`/projects/${dueId}`);
  await page.goBack();
  await expect(page).toHaveURL("/");
  await rows(page).getByRole("link", { name: blocked, exact: true }).click();
  await expect(page).toHaveURL(`/projects/${blockedId}`);
  await expect(page.getByRole("heading", { level: 1, name: blocked })).toBeVisible();

  // "Ver proyectos" goes to the module.
  await openToday(page);
  await section(page).getByRole("link", { name: "Ver proyectos" }).click();
  await expect(page).toHaveURL("/projects");
});

test("at 320 px the section doesn't scroll sideways", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  // Names are up to 80 characters (uniqueName adds ~14); one word longer than the screen.
  const long = uniqueName("Un nombre largo que no cabe: Electroencefalografistas", testInfo);
  const blocker = uniqueName("Otro proyecto con un nombre bastante largo", testInfo);
  const longId = await project({ name: long, due: -4 });
  await block(longId, await project({ name: blocker }));
  await page.setViewportSize({ width: 320, height: 640 });
  await openToday(page);
  await expect(row(page, long)).toContainText("Vencido hace 4 días");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const item of await rows(page).locator("li").all()) {
    await expectNoOverflow(page, item);
  }
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations; the section (reference screenshot)`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const blocked = uniqueName("Bloqueado", testInfo);
    await block(
      await project({ name: blocked }),
      await project({ name: uniqueName("A", testInfo) }),
    );
    await openToday(page);
    await setTheme(page, theme);
    await expect(row(page, blocked)).toBeVisible();
    await afterSaveSettled(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // The fixture rows only (due today, in 3 days and 2 days ago): the same every day.
    await expect(row(page, "Viaje a Cusco")).toContainText("Vence hoy");
    await expect(row(page, "Renovar pasaporte")).toContainText("Vence en 3 días");
    await expect(row(page, "Ruta por Europa")).toContainText("Vencido hace 2 días");
    await expectScreenshot(section(page), `today-projects-${theme}.png`, {
      stylePath: FIXTURE_ROWS_CSS,
    });
  });
}
