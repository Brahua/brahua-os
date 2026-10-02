import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { formatOwnerDay } from "@/lib/time";
import { afterSaveSettled } from "./support/saves";
import { fontsLoaded } from "./support/fonts";
import {
  closeFromDetail,
  CREATE_AREA,
  DETAIL_FIXTURE,
  expectNoOverflow,
  groupList,
  historyToggle,
  insertProject,
  limaDay,
  notices,
  openProject,
  openProjects,
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
  await afterSaveSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const statusGroup = (page: Page) => page.getByRole("radiogroup", { name: "Estado" });
const priorityGroup = (page: Page) => page.getByRole("radiogroup", { name: "Prioridad" });
const save = (page: Page) => page.getByRole("button", { name: "Guardar" });

/** The seeded area with the longest name ("Aprendizaje y Desarrollo profesional"). */
const LONG_AREA = { slug: "learning" };

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
  await page.getByRole("button", { name: /^Cambiar área/ }).click();
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

test("Marcar como terminado warns about open milestones, then the card is in Historial; Reabrir brings it back", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Repisa", testInfo);
  // In the area with the longest name: the done card that overflowed at 390 px (Checkpoint final).
  const id = await insertProject({
    name,
    due: 2,
    milestones: [true, false, false],
    areaSlug: LONG_AREA.slug,
  });
  await openProject(page, id);
  await expect(page.getByText("Vence en 2 días")).toBeVisible();
  // Terminado and Cancelado are no longer in the picker.
  await expect(statusGroup(page).getByRole("radio")).toHaveText([
    "Idea",
    "Activo",
    "Pausado",
    "Mantenimiento",
  ]);

  await page.getByRole("button", { name: "Marcar como terminado" }).click();
  const confirm = page.getByRole("group", { name: `¿Marcar «${name}» como terminado?` });
  await expect(confirm.getByRole("button", { name: "Volver" })).toBeFocused();
  await expect(confirm).toContainText("Quedan 2 hitos abiertos. ¿Terminar igual?");
  await untilSaved(page, () => confirm.getByRole("button", { name: "Sí, terminar" }).click());

  const finished = `Terminado el ${formatOwnerDay(new Date())}`;
  await expect(page.getByRole("button", { name: "Reabrir" })).toBeFocused();
  await expect(page.getByText(finished)).toBeVisible();
  await expect(page.locator("[data-detail-announcer]")).toHaveText(
    `«${name}» se marcó como terminado. Quedaron 2 hitos abiertos.`,
  );
  await expect(page.getByText("Vence en 2 días")).toBeHidden();
  await expect(statusGroup(page)).toHaveCount(0);

  // In the list it moved to Historial → Terminado, with its date, and fits the screen.
  await openProjects(page, `?area=${LONG_AREA.slug}`);
  await historyToggle(page).click();
  const card = groupList(page, "Terminado").locator("article", {
    has: page.getByRole("link", { name }),
  });
  await expect(card).toContainText(`Terminado el ${formatOwnerDay(new Date(), "short")}`);
  await expect(card).toContainText("1 de 3 hitos");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoOverflow(page, card);
  }

  await openProject(page, id);
  await page.getByRole("button", { name: "Reabrir" }).click();
  const reopen = page.getByRole("group", { name: `¿Reabrir «${name}»?` });
  await expect(reopen.getByRole("button", { name: "Volver" })).toBeFocused();
  expect(await axeViolations(page)).toEqual([]);
  await untilSaved(page, () => reopen.getByRole("button", { name: "Sí, reabrir" }).click());
  await expect(page.getByRole("button", { name: "Marcar como terminado" })).toBeFocused();
  await expect(statusGroup(page).getByRole("radio", { name: "Activo" })).toBeChecked();
  await expect(page.getByText(/^Terminado el /)).toBeHidden();
  await expect(page.getByText("Vence en 2 días")).toBeVisible();
  await page.reload();
  await expect(statusGroup(page).getByRole("radio", { name: "Activo" })).toBeChecked();
  await expect(page.getByText(/^Terminado el /)).toBeHidden();
});

test("Cancelar proyecto: a simple confirm step, Historial → Cancelado, and back", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Banca", testInfo);
  const id = await insertProject({ name, due: 0, milestones: [false] });
  await openProject(page, id);
  await page.getByRole("button", { name: "Cancelar proyecto" }).click();
  const confirm = page.getByRole("group", { name: `¿Cancelar «${name}»?` });
  // Positive control for the warning's absence: the step is there.
  await expect(confirm).toBeVisible();
  await expect(confirm.locator("[data-open-work-warning]")).toHaveCount(0);
  // Esc goes back without closing anything.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Cancelar proyecto" })).toBeFocused();

  await closeFromDetail(page, "Cancelar proyecto");
  await expect(page.locator("[data-closed-state]")).toHaveText("Se canceló.");
  await expect(page.getByText("Vence hoy")).toBeHidden();
  expect(await axeViolations(page)).toEqual([]);

  await openProjects(page, `?area=${CREATE_AREA.slug}`);
  await historyToggle(page).click();
  await expect(groupList(page, "Cancelado").getByRole("link", { name, exact: true })).toBeVisible();

  await openProject(page, id);
  await page.getByRole("button", { name: "Reabrir" }).click();
  await untilSaved(page, () => page.getByRole("button", { name: "Sí, reabrir" }).click());
  await expect(page.getByText("Vence hoy")).toBeVisible();
});

test("the priority options carry their LED: Alta orange like the card, the others neutral", async ({
  page,
}, testInfo) => {
  const id = await insertProject({ name: uniqueName("Lámpara", testInfo) });
  await openProject(page, id);
  for (const [name, priority] of [
    ["Baja", "low"],
    ["Media", "medium"],
    ["Alta", "high"],
  ] as const) {
    const led = priorityGroup(page)
      .getByRole("radio", { name, exact: true })
      .locator(`[data-priority-led="${priority}"]`);
    await expect(led).toBeVisible();
    await expect(led).toHaveAttribute("aria-hidden", "true");
  }
  await expect(priorityGroup(page).locator('[data-priority-led="high"]')).toHaveClass(
    /bo-led--signal/,
  );
  // Baja is a hollow ring; Media a filled one.
  await expect(priorityGroup(page).locator('[data-priority-led="low"]')).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(priorityGroup(page).locator('[data-priority-led="medium"]')).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
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
  await expect(notices(page)).toContainText(`«${name}» se eliminó.`);
  // The parameter left the URL, so a reload has nothing to repeat.
  expect(new URL(page.url()).search).toBe("");

  // Positive control: a full load that still has `?deleted=<id>` does show the notice (and
  // cleans the URL again), so its absence after the reload below means something.
  await page.goto(`/projects?deleted=${id}`);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await expect(notices(page)).toContainText(`«${name}» se eliminó.`);
  await expect.poll(() => new URL(page.url()).search).toBe("");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  // Well past the notice's delay (ANNOUNCE_DELAY_MS, 150 ms).
  await page.waitForTimeout(1_000);
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

    await page.getByRole("button", { name: /^Cambiar área/ }).click();
    await page.getByRole("button", { name: "Editar fechas" }).click();
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Eliminar proyecto" }).click();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Eliminar proyecto" })).toBeFocused();

    // "Cerrar proyecto": the done step with its warning (3 of 5 milestones open), not confirmed.
    await page.getByRole("button", { name: "Marcar como terminado" }).click();
    await expect(page.locator("[data-open-work-warning]")).toHaveText(
      "Quedan 3 hitos abiertos. ¿Terminar igual?",
    );
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Marcar como terminado" })).toBeFocused();
  });
}
