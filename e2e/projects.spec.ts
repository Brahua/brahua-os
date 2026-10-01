import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { animationsSettled } from "./support/animations";
import { fontsLoaded } from "./support/fonts";
import {
  areaGroup,
  cardNames,
  CREATE_AREA,
  FIXTURE_AREA,
  filterSheet,
  filterTrigger,
  groupList,
  historyToggle,
  isDesktop,
  nameField,
  newProjectButton,
  openProjects,
  pickArea,
  sheet,
  statusGroup,
  uniqueName,
} from "./support/projects";
import { expectScreenshot } from "./support/screenshots";

// Shared database: global-setup puts the fixture projects in "Planes y Viajes" (due dates
// relative to Lima's today), and these tests only look at that area through `?area=travel`.
// Tests that create projects do it in "Hobbies" with unique names, so they never change what the
// others (or the screenshots) see, and need no lock.

const THEMES = ["dark", "light"] as const;
const FIXTURE_FILTER = `?area=${FIXTURE_AREA.slug}`;
// The area filter stays: it is one "Área: Planes y Viajes" key, whatever areas other specs add.
const SCREENSHOT_CSS = path.join(__dirname, "support/hide-app-nav.css");

/** axe's violations, measured once keys and panels have finished fading or sliding. */
async function axeViolations(page: Page) {
  await animationsSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

test("Proyectos has its title and is in the navigation", async ({ page }) => {
  await openProjects(page);
  await expect(page).toHaveTitle("Proyectos · brahua-os");
  await expect(page.getByRole("link", { name: "Proyectos" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("2 goes to Proyectos (desktop)", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Shortcuts act from 1024 px");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await page.keyboard.press("2");
  await expect(page).toHaveURL("/projects");
  await expect(page.getByRole("heading", { level: 1, name: "Proyectos" })).toBeVisible();
});

test("groups by state in order, sorted by priority, due date and name, with due notices", async ({
  page,
}) => {
  await openProjects(page, FIXTURE_FILTER);
  const headings = page.locator("main").getByRole("heading", { level: 2 });
  const names = [
    "Activo, 2 proyectos",
    "Mantenimiento, 1 proyecto",
    "Pausado, 1 proyecto",
    "Idea, 1 proyecto",
    "Historial, 2 proyectos",
  ];
  await expect(headings).toHaveCount(names.length);
  for (const [index, name] of names.entries()) {
    await expect(headings.nth(index)).toHaveAccessibleName(name);
  }
  // High priority (due today) first, then the medium one due in 3 days.
  expect(await cardNames(page, "Activo")).toEqual(["Viaje a Cusco", "Renovar pasaporte"]);

  const card = (name: string) => page.locator("article", { has: page.getByRole("link", { name }) });
  await expect(card("Viaje a Cusco").locator("time")).toHaveText("Vence hoy");
  await expect(card("Viaje a Cusco")).toContainText("Prioridad alta");
  await expect(card("Renovar pasaporte").locator("time")).toHaveText("Vence en 3 días");
  await expect(card("Renovar pasaporte")).not.toContainText("Prioridad alta");
  await expect(card("Ruta por Europa").locator("time")).toHaveText("Vencido hace 2 días");
  // Maintenance: no due notice even past its date.
  await expect(card("Mapa de viajes").locator("time")).toHaveCount(0);
  // P3: progress from the milestones; none without them, nor in Mantenimiento (it has one).
  await expect(card("Viaje a Cusco").getByRole("meter")).toHaveAccessibleName(
    "Avance: 33%, 1 de 3 hitos",
  );
  await expect(card("Renovar pasaporte").getByRole("meter")).toHaveAccessibleName(
    "Avance: 100%, 2 de 2 hitos",
  );
  await expect(card("Mapa de viajes").getByRole("meter")).toHaveCount(0);
  await expect(card("Ruta por Europa").getByRole("meter")).toHaveCount(0);
});

test("the area filter lives in the URL", async ({ page }, testInfo) => {
  await openProjects(page);
  const trigger = filterTrigger(page);
  await expect(trigger).toHaveAccessibleName("Filtrar por área: Todas");
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  // One line, whatever the number of areas: as tall as a key.
  expect((await trigger.boundingBox())!.height).toBeLessThanOrEqual(48);

  // Bottom sheet on the phone, side panel on desktop; focus on the current option.
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(filterSheet(page)).toHaveClass(
    isDesktop(testInfo) ? /bo-sheet--side/ : /bo-sheet--bottom/,
  );
  const all = filterSheet(page).getByRole("link", { name: "Todas las áreas" });
  await expect(all).toHaveAttribute("aria-current", "page");
  await expect(all).toBeFocused();
  // Options are 44 px targets or more.
  for (const box of await filterSheet(page)
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height))) {
    expect(box).toBeGreaterThanOrEqual(44);
  }
  // Esc closes it and focus goes back to the key.
  await page.keyboard.press("Escape");
  await expect(filterSheet(page)).toBeHidden();
  await expect(trigger).toBeFocused();

  await pickArea(page, FIXTURE_AREA.name);
  await expect(page).toHaveURL(`/projects${FIXTURE_FILTER}`);
  await expect(trigger).toHaveAccessibleName(`Filtrar por área: ${FIXTURE_AREA.name}`);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Mostrando" })).toHaveText(
    `Mostrando los proyectos de «${FIXTURE_AREA.name}».`,
  );
  // Only that area: every card on screen is in it.
  const tags = page.locator("main article .bo-area-tag");
  await expect(tags.first()).toBeVisible();
  for (const text of await tags.allTextContents()) expect(text).toBe(FIXTURE_AREA.name);

  // Still filtered after a reload (it's in the URL), and marked in the list.
  await page.reload();
  await expect(trigger).toHaveAccessibleName(`Filtrar por área: ${FIXTURE_AREA.name}`);
  expect(await cardNames(page, "Activo")).toEqual(["Viaje a Cusco", "Renovar pasaporte"]);
  await trigger.click();
  const current = filterSheet(page).getByRole("link", { name: FIXTURE_AREA.name, exact: true });
  await expect(current).toHaveAttribute("aria-current", "page");
  await expect(current).toBeFocused();
  await expect(
    filterSheet(page).getByRole("link", { name: "Todas las áreas" }),
  ).not.toHaveAttribute("aria-current");

  await filterSheet(page).getByRole("link", { name: "Todas las áreas" }).click();
  await expect(page).toHaveURL("/projects");
  await expect(trigger).toHaveAccessibleName("Filtrar por área: Todas");
});

test("Historial is folded and opens to Terminado and Cancelado", async ({ page }) => {
  await openProjects(page, FIXTURE_FILTER);
  const toggle = historyToggle(page);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("link", { name: "Viaje a Arequipa" })).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(await cardNames(page, "Terminado")).toEqual(["Viaje a Arequipa"]);
  expect(await cardNames(page, "Cancelado")).toEqual(["Crucero"]);

  await toggle.click();
  await expect(groupList(page, "Terminado")).toBeHidden();
});

test("create a project on the phone in a few taps and land on its page", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Guitarra", testInfo);
  await openProjects(page);
  const start = Date.now();

  await newProjectButton(page).click();
  await expect(sheet(page)).toHaveAccessibleName("Nuevo proyecto");
  await expect(sheet(page)).toHaveClass(
    isDesktop(testInfo) ? /bo-sheet--side/ : /bo-sheet--bottom/,
  );
  await expect(nameField(page)).toBeFocused();
  await expect(statusGroup(page).getByRole("radio", { name: "Idea" })).toBeChecked();

  // Name, area, create: the state stays Idea.
  await page.keyboard.type(name);
  await areaGroup(page).getByRole("radio", { name: CREATE_AREA.name }).click();
  await sheet(page).getByRole("button", { name: "Crear proyecto" }).click();

  const heading = page.getByRole("heading", { level: 1, name });
  await expect(heading).toBeVisible();
  // SPEC-projects asks for under 10 s by a person on the phone; a robot's time says little about
  // that, so it is recorded in the report rather than asserted.
  testInfo.annotations.push({
    type: "create-to-detail-ms",
    description: String(Date.now() - start),
  });

  // Focus on the page's heading (the sheet and its key are gone), the creation announced, and
  // `?created=1` gone from the URL so a reload doesn't repeat it.
  await expect(heading).toBeFocused();
  await expect(page.locator("[data-created-notice]")).toHaveText(`Proyecto «${name}» creado.`);
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page).toHaveTitle(`${name} · brahua-os`);
  await expect(page.locator("main")).toContainText("Idea");
  await expect(page.locator("main")).toContainText(CREATE_AREA.name);
  // Opened again (a reload), it is just the project's page.
  await page.reload();
  await expect(heading).toBeVisible();
  await expect(page.locator("[data-created-notice]")).toHaveCount(0);

  // Back in the list, under Idea in its area.
  await page.getByRole("link", { name: "Volver a Proyectos" }).click();
  await expect(page).toHaveURL("/projects");
  await pickArea(page, CREATE_AREA.name);
  await expect(groupList(page, "Idea").getByRole("link", { name })).toBeVisible();
});

test("the list's area comes picked in the sheet, and errors show on each field", async ({
  page,
}) => {
  await openProjects(page, FIXTURE_FILTER);
  await newProjectButton(page).click();
  await expect(areaGroup(page).getByRole("radio", { name: FIXTURE_AREA.name })).toBeChecked();
  await areaGroup(page).getByRole("radio", { checked: true }).focus();
  // Arrows move through the areas (one tab stop).
  await page.keyboard.press("ArrowRight");
  await expect(areaGroup(page).getByRole("radio", { name: FIXTURE_AREA.name })).not.toBeChecked();

  await sheet(page).getByRole("button", { name: "Crear proyecto" }).click();
  await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(nameField(page)).toHaveAccessibleDescription("El nombre es obligatorio.");
  await expect(nameField(page)).toBeFocused();
  await expect(sheet(page)).toBeVisible();

  // Esc closes without creating; focus goes back to the key.
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expect(newProjectButton(page)).toBeFocused();
});

test("a project that doesn't exist is a 404 inside the shell", async ({ page }) => {
  for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
    const response = await page.goto(`/projects/${id}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Este proyecto no está");
    await expect(page).toHaveTitle("Proyecto no encontrado · brahua-os");
    await expect(page.getByRole("link", { name: "Volver a Proyectos" })).toBeVisible();
  }
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations and the reference screenshot`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/projects${FIXTURE_FILTER}`);
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(groupList(page, "Activo")).toBeVisible();
    await fontsLoaded(page);

    expect(await axeViolations(page)).toEqual([]);
    await expectScreenshot(page.locator("main"), `projects-list-${theme}.png`, {
      stylePath: SCREENSHOT_CSS,
    });

    // The area filter open.
    await filterTrigger(page).click();
    await expect(filterSheet(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(filterSheet(page)).toBeHidden();

    // The history open, and the create sheet with an error showing.
    await historyToggle(page).click();
    await expect(groupList(page, "Terminado")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await newProjectButton(page).click();
    await expect(nameField(page)).toBeFocused();
    await sheet(page).getByRole("button", { name: "Crear proyecto" }).click();
    await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
    expect(await axeViolations(page)).toEqual([]);
  });
}
