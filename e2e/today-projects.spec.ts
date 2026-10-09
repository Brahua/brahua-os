import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { CREATE_AREA, expectNoOverflow, isDesktop, uniqueName } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";
import { boardTest as test, insertTodayProject } from "./support/today-tasks";

// D3 of `today` (SPEC-today "Proyectos"): the projects due within a week and the blocked ones,
// last on "/", read only, each row a link to its project.
//
// The fixture projects ("Planes y Viajes", global-setup) are due today, in 3 days and 2 days ago,
// so "/" always has this section in the E2E database. Every test is a `boardTest`
// (e2e/support/today-tasks.ts), like the other tests that look at "/": the habits and tasks
// locks, with the tasks due today parked. Its projects come from `insertTodayProject` (in
// "Hobbies", with unique names), soft-deleted when the test ends; the screenshot only shows the
// fixture rows.

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

/** A project of the test in "Hobbies" (soft-deleted when it ends). */
const project = (name: string, options?: Parameters<typeof insertTodayProject>[2]) =>
  insertTodayProject(name, CREATE_AREA.slug, options);

test("a project due in 3 days and a blocked one show on Hoy, each a link", async ({
  page,
}, testInfo) => {
  const due = uniqueName("Renovar la licencia", testInfo);
  const blocker = uniqueName("Ahorrar", testInfo);
  const other = uniqueName("Elegir el local", testInfo);
  const blocked = uniqueName("Boda", testInfo);
  const dueId = await project(due, { due: 3 });
  // Neither blocker is due nor blocked: they don't show up themselves.
  const blockerId = await project(blocker);
  const otherId = await project(other, { due: 30 });
  const blockedId = await project(blocked, { blockedBy: [blockerId, otherId] });
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

test("at 320 px the section doesn't scroll sideways @responsive", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  // Names are up to 80 characters (uniqueName adds ~14); one word longer than the screen.
  const long = uniqueName("Un nombre largo que no cabe: Electroencefalografistas", testInfo);
  const blocker = uniqueName("Otro proyecto con un nombre bastante largo", testInfo);
  await project(long, { due: -4, blockedBy: [await project(blocker)] });
  await page.setViewportSize({ width: 320, height: 640 });
  await openToday(page);
  await expect(row(page, long)).toContainText("Vencido hace 4 días");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const item of await rows(page).locator("li").all()) {
    await expectNoOverflow(page, item);
  }
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations; the section (reference screenshot) @responsive`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const blocked = uniqueName("Bloqueado", testInfo);
    await project(blocked, { blockedBy: [await project(uniqueName("A", testInfo))] });
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
