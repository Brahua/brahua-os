import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import {
  addTaskField,
  groupHeadings,
  insertProjectTasks,
  isNextAction,
  nextFlag,
  sectionTitles,
  tasksSection,
} from "./support/project-tasks";
import {
  CREATE_AREA,
  insertProject,
  notices,
  openProject,
  openProjects,
  uniqueName,
  untilSaved,
} from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";
import { tasksTest as test } from "./support/today-tasks";

// T5 of `tasks`: tasks in projects. Every test works on its own project (inserted in "Hobbies"
// with a unique name), so they run in parallel without a lock; the ones that complete a task (or
// insert a done one) hold the shared tasks lock (`@today-tasks`): a board test would park it.

const THEMES = ["dark", "light"] as const;

const meter = (page: Page) => page.getByRole("meter");
const undo = (page: Page) => notices(page).getByRole("button", { name: "Deshacer" });

/** Adds a task with Enter in the section, waiting for the server before the next one. */
async function addTask(page: Page, title: string) {
  await addTaskField(page).fill(title);
  await untilSaved(page, () => addTaskField(page).press("Enter"));
  await expect(addTaskField(page)).toHaveValue("");
  await expect(tasksSection(page).getByRole("link", { name: title, exact: true })).toBeVisible();
}

async function axeViolations(page: Page) {
  await afterSaveSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

/** The card of `name` in the list of "Hobbies". */
async function cardOf(page: Page, name: string) {
  await openProjects(page, `?area=${CREATE_AREA.slug}`);
  const link = page.getByRole("link", { name, exact: true });
  return { link, card: page.locator("article", { has: link }) };
}

test("add with Enter (to a milestone too), grouped by milestone; the progress counts tasks @today-tasks", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Taller", testInfo);
  // Two milestones, the first done: "1 de 2" before any task.
  const id = await insertProject({ name, milestones: [true, false] });
  await openProject(page, id);
  await expect(meter(page)).toHaveAccessibleName("Avance: 50%, 1 de 2 hitos y tareas");
  await expect(tasksSection(page)).toContainText("Sin tareas pendientes.");

  await addTaskField(page).focus();
  await addTask(page, "Comprar madera");
  // Enter adds another: the field is still under the cursor.
  await expect(addTaskField(page)).toBeFocused();
  // Without tasks in milestones: one flat list, no "Sin hito" heading.
  expect(await groupHeadings(page)).toEqual([]);

  await tasksSection(page)
    .getByRole("combobox", { name: "Hito" })
    .selectOption({ label: "Hito 2" });
  await addTask(page, "Pintar");
  // The milestone stays for the next one.
  await addTask(page, "Lijar");
  expect(await groupHeadings(page)).toEqual(["Hito 2", "Sin hito"]);
  expect(await sectionTitles(page)).toEqual(["Pintar", "Lijar", "Comprar madera"]);
  // 1 of 2 milestones plus 0 of 3 tasks.
  await expect(meter(page)).toHaveAccessibleName("Avance: 20%, 1 de 5 hitos y tareas");
  await expect(page.locator("[data-project-progress]")).toContainText("1 de 5 · hitos y tareas");

  // Completing a task moves the progress (after the server: the section's revalidation).
  await untilSaved(page, () =>
    tasksSection(page).getByRole("checkbox", { name: "Hecha: Comprar madera" }).click(),
  );
  await expect(notices(page)).toContainText("«Comprar madera» está hecha.");
  await expect(meter(page)).toHaveAccessibleName("Avance: 40%, 2 de 5 hitos y tareas");
  // The done one, folded under "Hechas".
  const doneToggle = tasksSection(page).getByRole("button", {
    name: "Hechas en los últimos 30 días, 1",
  });
  await expect(doneToggle).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  expect(await groupHeadings(page)).toEqual(["Hito 2"]);
  expect(await sectionTitles(page)).toEqual(["Pintar", "Lijar"]);
  await expect(meter(page)).toHaveAccessibleName("Avance: 40%, 2 de 5 hitos y tareas");

  // The card shows the same progress: "N de M".
  const { link, card } = await cardOf(page, name);
  await expect(link).toHaveAccessibleDescription(/Avance: 40%, 2 de 5 hitos y tareas/);
  await expect(card.locator("[data-progress]")).toHaveAttribute("data-progress", "2/5");
  await expect(card).toContainText("2 de 5");
});

test("the next action: one per project, on the card; complete it from the card and undo @today-tasks", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Cocina", testInfo);
  const id = await insertProject({ name });
  const [measure, draw] = await insertProjectTasks(id, [
    { title: "Medir paredes" },
    { title: "Dibujar planta" },
  ]);
  await openProject(page, id);
  await expect(tasksSection(page)).toContainText("Sin próxima acción");

  await untilSaved(page, () => nextFlag(page, "Medir paredes").click());
  await expect(nextFlag(page, "Medir paredes")).toHaveAttribute("aria-pressed", "true");
  await expect(tasksSection(page)).toContainText("Próxima acción: Medir paredes");
  // Marking another one takes the mark (one per project).
  await untilSaved(page, () => nextFlag(page, "Dibujar planta").click());
  await expect(nextFlag(page, "Dibujar planta")).toHaveAttribute("aria-pressed", "true");
  await expect(nextFlag(page, "Medir paredes")).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(nextFlag(page, "Dibujar planta")).toHaveAttribute("aria-pressed", "true");
  expect(await isNextAction(measure)).toBe(false);

  // On the card: the key, and the name link says it.
  const { link, card } = await cardOf(page, name);
  const key = card.locator("[data-next-action]");
  await expect(key).toContainText("Siguiente tarea");
  await expect(key).toContainText("Dibujar planta");
  await expect(link).toHaveAccessibleDescription(/Siguiente tarea: Dibujar planta/);

  // Complete it from the card: gone at once, with "Deshacer".
  const check = card.getByRole("checkbox", { name: "Hecha: Dibujar planta" });
  await untilSaved(page, () => check.click());
  await expect(key).toHaveCount(0);
  await expect(notices(page)).toContainText("«Dibujar planta» está hecha.");
  // Completing clears the mark: it doesn't move to the other task.
  expect(await isNextAction(draw)).toBe(false);
  expect(await isNextAction(measure)).toBe(false);

  // "Deshacer": pending again and the next action again.
  await untilSaved(page, () => undo(page).click());
  await expect(card.locator("[data-next-action]")).toContainText("Dibujar planta");
  await expect(page.getByText("«Dibujar planta» volvió a ser la siguiente tarea.")).toBeAttached();
  await page.reload();
  await expect(
    page
      .locator("article", { has: page.getByRole("link", { name, exact: true }) })
      .locator("[data-next-action]"),
  ).toContainText("Dibujar planta");
  expect(await isNextAction(draw)).toBe(true);
});

test("completing the next action in the section clears it; the detail's switch marks it @today-tasks", async ({
  page,
}, testInfo) => {
  const name = uniqueName("Baño", testInfo);
  const id = await insertProject({ name });
  await insertProjectTasks(id, [{ title: "Cambiar grifo", next: true }, { title: "Sellar ducha" }]);
  await openProject(page, id);
  await untilSaved(page, () =>
    tasksSection(page).getByRole("checkbox", { name: "Hecha: Cambiar grifo" }).click(),
  );
  await expect(tasksSection(page)).toContainText("Sin próxima acción");
  await expect(nextFlag(page, "Sellar ducha")).toHaveAttribute("aria-pressed", "false");

  // The task's detail (sheet on the desktop, page on the phone) has the switch.
  await tasksSection(page).getByRole("link", { name: "Sellar ducha" }).click();
  const toggle = page.getByRole("switch", { name: `Es la próxima acción de «${name}»` });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  // Saved: said once the server answered (the task's page also posts its milestone options, so
  // waiting for any action's response isn't enough).
  await expect(page.getByText("«Sellar ducha» es la próxima acción.")).toBeAttached();
  await openProject(page, id);
  await expect(nextFlag(page, "Sellar ducha")).toHaveAttribute("aria-pressed", "true");
});

test("Marcar como terminado counts the open tasks too @today-tasks", async ({ page }, testInfo) => {
  const name = uniqueName("Repisa", testInfo);
  const id = await insertProject({ name, milestones: [false] });
  await insertProjectTasks(id, [
    { title: "Cortar" },
    { title: "Pintar" },
    { title: "Medir", done: true },
  ]);
  await openProject(page, id);
  await page.getByRole("button", { name: "Marcar como terminado" }).click();
  await expect(page.getByRole("group", { name: /como terminado\?/ })).toContainText(
    "Quedan 1 hito abierto y 2 tareas abiertas. ¿Terminar igual?",
  );
  await untilSaved(page, () => page.getByRole("button", { name: "Sí, terminar" }).click());
  await expect(page.getByRole("button", { name: "Reabrir" })).toBeFocused();
  // Closed: no adding, no marks, and it says why.
  await expect(addTaskField(page)).toHaveCount(0);
  await expect(tasksSection(page)).toContainText("El proyecto está cerrado");
  await expect(nextFlag(page, "Cortar")).toHaveCount(0);
});

for (const theme of THEMES) {
  test(`axe: the section, the card's key and the notice in the ${theme} theme @today-tasks @responsive`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const name = uniqueName("Axe", testInfo);
    const id = await insertProject({ name, milestones: [true, false] });
    await insertProjectTasks(id, [
      { title: "Medir", milestone: 1, next: true },
      { title: "Comprar", milestone: 0 },
      { title: "Llamar" },
      { title: "Hecha antes", done: true },
    ]);
    await openProject(page, id);
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    // A full load, so the stored theme applies from the first paint.
    await openProject(page, id);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await tasksSection(page)
      .getByRole("button", { name: "Hechas en los últimos 30 días, 1" })
      .click();
    expect(await axeViolations(page)).toEqual([]);
    await expectScreenshot(tasksSection(page), `project-tasks-${theme}.png`);

    // An empty add (its error), then a mark with its announcement.
    await addTaskField(page).press("Enter");
    await expect(addTaskField(page)).toHaveAccessibleDescription(/Escribe qué hay que hacer\./);
    expect(await axeViolations(page)).toEqual([]);

    // The card's key, and the notice after completing it.
    const { card } = await cardOf(page, name);
    await expect(card.locator("[data-next-action]")).toContainText("Medir");
    expect(await axeViolations(page)).toEqual([]);
    await untilSaved(page, () => card.getByRole("checkbox", { name: "Hecha: Medir" }).click());
    await expect(notices(page)).toContainText("«Medir» está hecha.");
    expect(await axeViolations(page)).toEqual([]);
  });
}
