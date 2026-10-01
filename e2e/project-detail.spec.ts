import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { formatOwnerDay } from "@/lib/time";
import { animationsSettled } from "./support/animations";
import { fontsLoaded } from "./support/fonts";
import {
  CREATE_AREA,
  DETAIL_FIXTURE,
  groupList,
  historyToggle,
  insertProject,
  limaDay,
  notices,
  openProject,
  uniqueName,
  untilSaved,
} from "./support/projects";
import { expectScreenshot } from "./support/screenshots";

// P2: a project's page. Tests that edit or delete work on their own project (inserted in
// "Hobbies" with a unique name), so they run in parallel without a lock; the screenshots show the
// read-only fixture DETAIL_FIXTURE (fixed dates, so the page is the same every day).

const THEMES = ["dark", "light"] as const;
const SCREENSHOT_CSS = [path.join(__dirname, "support/hide-app-nav.css")];

async function axeViolations(page: Page) {
  await animationsSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const statusGroup = (page: Page) => page.getByRole("radiogroup", { name: "Estado" });
const priorityGroup = (page: Page) => page.getByRole("radiogroup", { name: "Prioridad" });
const save = (page: Page) => page.getByRole("button", { name: "Guardar" });

test("edit every field in place; each survives a reload", async ({ page }, testInfo) => {
  const name = uniqueName("Taller", testInfo);
  const id = await insertProject({ name });
  await openProject(page, id);
  await expect(heading(page)).toHaveText(name);

  // Name: the pencil opens the field with focus; Enter saves.
  const renamed = `${name} 2`;
  await page.getByRole("button", { name: "Editar nombre" }).click();
  const nameField = page.getByRole("textbox", { name: "Nombre" });
  await expect(nameField).toBeFocused();
  await nameField.fill(renamed);
  await untilSaved(page, () => nameField.press("Enter"));
  await expect(heading(page)).toHaveText(renamed);
  await expect(page.getByRole("button", { name: "Editar nombre" })).toBeFocused();

  // Priority and state: saved the moment they change.
  await untilSaved(page, () => priorityGroup(page).getByRole("radio", { name: "Alta" }).click());
  await untilSaved(page, () => statusGroup(page).getByRole("radio", { name: "Pausado" }).click());

  // Area: only active ones.
  await page.getByRole("button", { name: "Cambiar área" }).click();
  await page
    .getByRole("radiogroup", { name: "Área" })
    .getByRole("radio", { name: "Trabajo" })
    .click();
  await untilSaved(page, () => save(page).click());

  // Objective.
  await page.getByRole("button", { name: "Editar objetivo" }).click();
  await page.getByRole("textbox", { name: "Objetivo" }).fill("Mesa de trabajo armada.");
  await untilSaved(page, () => save(page).click());

  // Dates: the end before the start is refused on the end's field, then fixed.
  await page.getByRole("button", { name: "Editar fechas" }).click();
  const start = page.getByLabel("Inicio");
  const due = page.getByLabel("Fin");
  await start.fill(limaDay(2));
  await due.fill(limaDay(1));
  await save(page).click();
  await expect(due).toHaveAttribute("aria-invalid", "true");
  await expect(due).toHaveAccessibleDescription(
    "La fecha de fin no puede ser anterior a la de inicio.",
  );
  await expect(due).toBeFocused();
  await due.fill(limaDay(5));
  await untilSaved(page, () => save(page).click());
  await expect(page.getByText("Vence en 5 días")).toBeVisible();

  await page.reload();
  await expect(heading(page)).toHaveText(renamed);
  await expect(priorityGroup(page).getByRole("radio", { name: "Alta" })).toBeChecked();
  await expect(statusGroup(page).getByRole("radio", { name: "Pausado" })).toBeChecked();
  await expect(page.locator("main header")).toContainText("Trabajo");
  await expect(page.getByText("Mesa de trabajo armada.")).toBeVisible();
  await expect(page.getByText("Vence en 5 días")).toBeVisible();
  await expect(page).toHaveTitle(`${renamed} · brahua-os`);
});

test("Terminado records the day it ended (in the card too) and going back clears it", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Repisa", testInfo);
  const id = await insertProject({ name, due: 2 });
  await openProject(page, id);
  await expect(page.getByText("Vence en 2 días")).toBeVisible();

  const finished = `Terminado el ${formatOwnerDay(new Date())}`;
  await untilSaved(page, () => statusGroup(page).getByRole("radio", { name: "Terminado" }).click());
  await expect(page.getByText(finished)).toBeVisible();
  await expect(page.getByText("Vence en 2 días")).toBeHidden();

  // In the list it moved to Historial → Terminado, with its date.
  await page.goto(`/projects?area=${CREATE_AREA.slug}`);
  await historyToggle(page).click();
  const card = groupList(page, "Terminado").locator("article", {
    has: page.getByRole("link", { name }),
  });
  await expect(card).toContainText(`Terminado el ${formatOwnerDay(new Date(), "short")}`);

  await openProject(page, id);
  await untilSaved(page, () => statusGroup(page).getByRole("radio", { name: "Activo" }).click());
  await expect(page.getByText(/^Terminado el /)).toBeHidden();
  await expect(page.getByText("Vence en 2 días")).toBeVisible();
  await page.reload();
  await expect(statusGroup(page).getByRole("radio", { name: "Activo" })).toBeChecked();
  await expect(page.getByText(/^Terminado el /)).toBeHidden();
});

test("the due notice shows only in Idea, Activo and Pausado; Mantenimiento hides the end", async ({
  page,
}, testInfo) => {
  const id = await insertProject({ name: uniqueName("Bici", testInfo), due: 0 });
  await openProject(page, id);
  const notice = page.getByText("Vence hoy");
  // Positive control first: with the notice there, its absence below means something.
  await expect(notice).toBeVisible();

  for (const [state, shown] of [
    ["Idea", true],
    ["Mantenimiento", false],
    ["Pausado", true],
    ["Cancelado", false],
    ["Activo", true],
  ] as const) {
    await untilSaved(page, () => statusGroup(page).getByRole("radio", { name: state }).click());
    if (shown) await expect(notice).toBeVisible();
    else await expect(notice).toBeHidden();
    const maintenanceNote = page.getByText("En Mantenimiento no hay fecha de fin.");
    if (state === "Mantenimiento") await expect(maintenanceNote).toBeVisible();
    else await expect(maintenanceNote).toBeHidden();
  }
});

test("delete, then Deshacer from the list's notice brings it back", async ({ page }, testInfo) => {
  const name = uniqueName("Estante", testInfo);
  const id = await insertProject({ name });
  await openProject(page, id);

  await page.getByRole("button", { name: "Eliminar proyecto" }).click();
  const confirm = page.getByRole("group", { name: `¿Eliminar «${name}»?` });
  await expect(confirm.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await confirm.getByRole("button", { name: "Sí, eliminar" }).click();

  await expect(page).toHaveURL("/projects");
  const listHeading = page.getByRole("heading", { level: 1, name: "Proyectos" });
  await expect(listHeading).toBeFocused();
  await expect(notices(page)).toContainText(`«${name}» se eliminó.`);
  await expect(page.getByRole("link", { name })).toHaveCount(0);

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(notices(page)).toContainText(`«${name}» volvió a tus proyectos.`);
  await expect(page.getByRole("link", { name })).toBeVisible();
  // Focus never ends up on <body>.
  await expect(page.locator("body")).not.toBeFocused();

  await openProject(page, id);
  await expect(heading(page)).toHaveText(name);
});

test("a deleted project is a 404 and isn't in the list", async ({ page }, testInfo) => {
  const name = uniqueName("Cajón", testInfo);
  const id = await insertProject({ name });
  await openProject(page, id);
  await page.getByRole("button", { name: "Eliminar proyecto" }).click();
  await page.getByRole("button", { name: "Sí, eliminar" }).click();
  await expect(page).toHaveURL("/projects");
  await expect(notices(page)).toContainText(`«${name}» se eliminó.`);

  // Reloading the list doesn't repeat the notice (the parameter is gone).
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Proyectos" })).toBeVisible();
  await expect(page.getByRole("link", { name })).toHaveCount(0);
  await expect(notices(page)).not.toContainText(name);

  const response = await page.goto(`/projects/${id}`);
  expect(response?.status()).toBe(404);
  await expect(heading(page)).toHaveText("Este proyecto no está");
  await expect(page).toHaveTitle("Proyecto no encontrado · brahua-os");
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations and the reference screenshot`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/projects");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    // A full load, so the stored theme applies from the first paint.
    const href = await page.getByRole("link", { name: DETAIL_FIXTURE.name }).getAttribute("href");
    await page.goto(href ?? "");
    await expect(heading(page)).toHaveText(DETAIL_FIXTURE.name);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
    await fontsLoaded(page);

    expect(await axeViolations(page)).toEqual([]);
    await expectScreenshot(page.locator("main"), `project-detail-${theme}.png`, {
      stylePath: SCREENSHOT_CSS,
    });

    // The editors and the delete confirm, opened and closed without saving (read-only fixture).
    await page.getByRole("button", { name: "Editar nombre" }).click();
    await page.getByRole("textbox", { name: "Nombre" }).fill("");
    await save(page).click();
    await expect(page.getByRole("textbox", { name: "Nombre" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Cambiar área" }).click();
    await page.getByRole("button", { name: "Editar fechas" }).click();
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Eliminar proyecto" }).click();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Eliminar proyecto" })).toBeFocused();
  });
}
