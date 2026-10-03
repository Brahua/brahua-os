import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import {
  activeHabitOrder,
  expect,
  habitsCount,
  insertHabit,
  limaWeekday,
  notDuePads,
  notDueToggle,
  openHabits,
  pad,
  pads,
  readHabit,
  openWeek,
  readHabitByName,
  test,
} from "./support/habits";
import { isDesktop, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// H2 of `habits`: frequencies in the form (fixed days, X a week), "Nada toca hoy" and "No tocan
// hoy", the week on the pad, edit, archive and reactivate, the manual order, axe in both themes
// and the screenshots of "Hoy" with every section. Every test holds the habits lock and starts
// from an empty "Hoy" (e2e/support/habits.ts).

const THEMES = ["dark", "light"] as const;
const SCREENSHOT_CSS = path.join(__dirname, "support/hide-app-nav.css");
const WEEKDAY_NAMES = [
  "",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

async function axeViolations(page: Page) {
  await afterSaveSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

const unique = (prefix: string, testInfo: TestInfo) =>
  `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 6)}`;

/** Any habit's pad by name, on "Hoy" or under "No tocan hoy". */
const anyPad = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** "Ordenar hábitos": the rows' names, in order. */
const orderRows = (page: Page) =>
  page.getByRole("list", { name: "Orden de tus hábitos" }).locator("li .line-clamp-2");

/** dnd-kit's live region, which speaks the drag in Spanish. */
const dragStatus = (page: Page) => page.locator('[id^="DndLiveRegion"]');

/** Two frames and a beat: dnd-kit measures the rows right after a lift or a move. */
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50))),
      ),
  );
}

test("create on fixed days of another day: 'Nada toca hoy' and 'No tocan hoy' opens with it", async ({
  page,
}, testInfo) => {
  const name = unique("Inglés", testInfo);
  // Tomorrow's weekday: never today's.
  const tomorrow = limaWeekday(1);
  await openHabits(page);
  await page.getByRole("button", { name: "Crear un hábito" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo hábito" });
  await sheet.getByRole("textbox", { name: "Nombre" }).fill(name);
  await sheet.getByRole("radio", { name: "Días fijos" }).click();
  // No day yet: an error on the days, focus on the first one.
  await sheet.getByRole("button", { name: "Crear hábito" }).click();
  await expect(sheet.getByRole("button", { name: "Lunes" })).toBeFocused();
  await expect(sheet.getByText("Elige al menos un día.")).toBeVisible();
  await sheet.getByRole("button", { name: WEEKDAY_NAMES[tomorrow] }).click();
  await expect(sheet.getByText(`${WEEKDAY_NAMES[tomorrow]} · Sí o no`)).toBeVisible();
  await untilSaved(page, () => sheet.getByRole("button", { name: "Crear hábito" }).click());
  await expect(sheet).toBeHidden();

  // Not due today: nothing in today's grid, the section opens and its pad has focus.
  await expect(page.getByText("Nada toca hoy")).toBeVisible();
  await expect(habitsCount(page)).toHaveCount(0);
  await expect(notDueToggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(anyPad(page, name)).toBeFocused();
  expect(await readHabitByName(name)).toMatchObject({
    frequency: "weekdays",
    weekdays: [tomorrow],
    weeklyTarget: null,
  });

  // It can be logged today anyway; the count stays out of it.
  await untilSaved(page, () => anyPad(page, name).click());
  await expect(anyPad(page, name)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Nada toca hoy")).toBeVisible();
  await expect(habitsCount(page)).toHaveCount(0);
  await page.reload();
  await expect(notDueToggle(page)).toHaveAttribute("aria-expanded", "false");
  await notDueToggle(page).click();
  await expect(notDuePads(page).getByRole("button", { name, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("create a weekly habit: '0 de N esta semana', a tap makes it 1", async ({
  page,
}, testInfo) => {
  const name = unique("Gimnasio", testInfo);
  // H4: created today, this week asks for its part: ceil(3 × days left until Sunday / 7).
  const quota = Math.ceil((3 * (8 - limaWeekday(0))) / 7);
  await openHabits(page);
  await page.getByRole("button", { name: "Nuevo hábito" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo hábito" });
  await sheet.getByRole("textbox", { name: "Nombre" }).fill(name);
  await sheet.getByRole("radio", { name: "Por semana" }).click();
  await expect(sheet.getByRole("radio", { name: "3", exact: true })).toBeChecked();
  await expect(sheet.getByText("3 veces por semana · Sí o no")).toBeVisible();
  await untilSaved(page, () => sheet.getByRole("button", { name: "Crear hábito" }).click());
  await expect(sheet).toBeHidden();
  await expect(pad(page, name)).toBeFocused();
  await expect(pad(page, name)).toHaveAccessibleDescription(`0 de ${quota} esta semana`);
  await untilSaved(page, () => pad(page, name).click());
  await expect(pad(page, name).locator("[data-habit-week]")).toHaveText(
    `1 de ${quota} esta semana`,
  );
  await page.reload();
  await expect(pad(page, name)).toHaveAccessibleDescription(
    new RegExp(`^1 de ${quota} esta semana`),
  );
  expect(await readHabitByName(name)).toMatchObject({ frequency: "weekly_count", weeklyTarget: 3 });
});

test("edit from the options: name and frequency; it moves to 'No tocan hoy'", async ({
  page,
}, testInfo) => {
  const name = unique("Leer", testInfo);
  const renamed = unique("Leer más", testInfo);
  const id = await insertHabit({ name });
  await insertHabit({ name: unique("Otro", testInfo) });
  await openHabits(page);
  await pads(page)
    .getByRole("button", { name: `Opciones de «${name}»` })
    .click();
  await page.getByRole("dialog", { name }).getByRole("button", { name: "Editar" }).click();
  const sheet = page.getByRole("dialog", { name: "Editar hábito" });
  const field = sheet.getByRole("textbox", { name: "Nombre" });
  await expect(field).toHaveValue(name);
  await expect(sheet.getByRole("radio", { name: "Diaria" })).toBeChecked();
  await field.fill(renamed);
  await sheet.getByRole("radio", { name: "Días fijos" }).click();
  await sheet.getByRole("button", { name: WEEKDAY_NAMES[limaWeekday(1)] }).click();
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar cambios" }).click());
  await expect(sheet).toBeHidden();
  await expect(notDueToggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(anyPad(page, renamed)).toBeFocused();
  await expect(habitsCount(page)).toHaveText("0 de 1 hoy");
  expect(await readHabit(id)).toMatchObject({
    name: renamed,
    frequency: "weekdays",
    weekdays: [limaWeekday(1)],
  });
});

test("archive with Deshacer; reactivate from 'Archivados' (in 'Semana') at the end", async ({
  page,
}, testInfo) => {
  const name = unique("Correr", testInfo);
  const next = unique("Agua", testInfo);
  const id = await insertHabit({ name, sortOrder: 0 });
  await insertHabit({ name: next, sortOrder: 1 });
  await openHabits(page);
  await pads(page)
    .getByRole("button", { name: `Opciones de «${name}»` })
    .click();
  await untilSaved(page, () =>
    page.getByRole("dialog", { name }).getByRole("button", { name: "Archivar" }).click(),
  );
  await expect(pad(page, name)).toHaveCount(0);
  await expect(pad(page, next)).toBeFocused();
  await expect(notices(page).getByText(`«${name}» se archivó.`)).toBeVisible();
  await expect.poll(async () => (await readHabit(id)).archivedAt).not.toBeNull();

  // Deshacer: back in its place.
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(pads(page).locator("[data-habit-pad]").first()).toHaveAccessibleName(name);
  await expect.poll(async () => (await readHabit(id)).archivedAt).toBeNull();

  // Archive again, then "Reactivar" from the folded list: last.
  await pads(page)
    .getByRole("button", { name: `Opciones de «${name}»` })
    .click();
  await untilSaved(page, () =>
    page.getByRole("dialog", { name }).getByRole("button", { name: "Archivar" }).click(),
  );
  // H5: "Archivados" is in "Semana".
  await expect(page.getByRole("button", { name: /^Archivados/ })).toHaveCount(0);
  await openWeek(page);
  const archived = page.getByRole("button", { name: /^Archivados/ });
  await expect(archived).toHaveAttribute("aria-expanded", "false");
  await archived.click();
  await untilSaved(page, () => page.getByRole("button", { name: `Reactivar «${name}»` }).click());
  // The last one: focus to the page's heading; the habit is in the week again.
  await expect(page.getByRole("heading", { level: 1, name: "Hábitos" })).toBeFocused();
  await expect(notices(page).getByText(`«${name}» volvió a tus hábitos.`)).toBeVisible();
  await expect(archived).toHaveCount(0);
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await openHabits(page);
  await expect(pads(page).locator("[data-habit-pad]").last()).toHaveAccessibleName(name);
});

test("reorder with Subir/Bajar and a keyboard drag; it is the order of 'Hoy'", async ({
  page,
}, testInfo) => {
  const a = unique("Uno", testInfo);
  const b = unique("Dos", testInfo);
  const c = unique("Tres", testInfo);
  await insertHabit({ name: a, sortOrder: 0 });
  // Not due today: it is in the order too.
  await insertHabit({ name: b, sortOrder: 1, weekdays: [limaWeekday(1)] });
  await insertHabit({ name: c, sortOrder: 2 });
  await openHabits(page);
  const order = page.getByRole("button", { name: "Ordenar", exact: true });
  await order.click();
  await expect(order).toHaveAttribute("aria-pressed", "true");
  await expect(orderRows(page)).toHaveText([a, b, c]);

  await untilSaved(page, () => page.getByRole("button", { name: `Bajar «${a}»` }).click());
  await expect(orderRows(page)).toHaveText([b, a, c]);
  await expect(page.getByRole("button", { name: `Bajar «${a}»` })).toBeFocused();
  await expect(notices(page).getByText(`«${a}» pasó al lugar 2 de 3.`)).toBeVisible();
  await expect.poll(activeHabitOrder).toEqual([b, a, c]);

  // Keyboard drag on the handle (dnd-kit loaded: it has its role description).
  const handle = page.getByRole("button", { name: `Mover «${c}»` });
  await expect(handle).toHaveAttribute("aria-roledescription", "elemento ordenable");
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(dragStatus(page)).toContainText(`Tomaste «${c}»`);
  await settle(page);
  for (let step = 0; step < 2; step++) {
    const before = await dragStatus(page).textContent();
    await page.keyboard.press("ArrowUp");
    await expect(dragStatus(page)).not.toHaveText(before ?? "");
    await settle(page);
  }
  await untilSaved(page, () => page.keyboard.press("Space"));
  await expect(orderRows(page)).toHaveText([c, b, a]);
  await expect(handle).toBeFocused();
  await expect.poll(activeHabitOrder).toEqual([c, b, a]);

  // Back to the pads: today's grid in the new order.
  await order.click();
  await expect(pads(page).locator("[data-habit-pad]")).toHaveText([new RegExp(c), new RegExp(a)]);
  await page.reload();
  await expect(pads(page).locator("[data-habit-pad]")).toHaveText([new RegExp(c), new RegExp(a)]);
});

test("at 320 px the form's frequency and the order list don't scroll sideways", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await insertHabit({ name: "Un hábito con un nombre bastante largo para una pantalla angosta" });
  await insertHabit({ name: "Leer", weeklyTarget: 3 });
  await page.setViewportSize({ width: 320, height: 640 });
  await openHabits(page);
  const width = () => page.evaluate(() => document.documentElement.scrollWidth);
  await page.getByRole("button", { name: "Ordenar", exact: true }).click();
  await expect(orderRows(page)).toHaveCount(2);
  expect(await width()).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "Ordenar", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo hábito" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo hábito" });
  const body = sheet.locator("form");
  for (const radio of ["Días fijos", "Por semana"]) {
    await sheet.getByRole("radio", { name: radio }).click();
    expect(await body.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await width()).toBeLessThanOrEqual(320);
  }
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (sections, the frequency, order)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertHabit({ name: "Meditar", area: "health", done: true, sortOrder: 0 });
    await insertHabit({ name: "Gimnasio", area: "health", weeklyTarget: 3, sortOrder: 1 });
    await insertHabit({
      name: "Inglés",
      area: "learning",
      weekdays: [limaWeekday(1)],
      sortOrder: 2,
    });
    await insertHabit({ name: "Estirar", sortOrder: 4 });
    await openHabits(page);
    await setTheme(page, theme);
    await notDueToggle(page).click();
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Nuevo hábito" }).click();
    const form = page.getByRole("dialog", { name: "Nuevo hábito" });
    await form.getByRole("radio", { name: "Días fijos" }).click();
    await form.getByRole("button", { name: "Crear hábito" }).click();
    await expect(form.getByText("Elige al menos un día.")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await form.getByRole("radio", { name: "Por semana" }).click();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();

    // The archive notice with "Deshacer".
    await pads(page).getByRole("button", { name: "Opciones de «Estirar»" }).click();
    await untilSaved(page, () =>
      page
        .getByRole("dialog", { name: "Estirar" })
        .getByRole("button", { name: "Archivar" })
        .click(),
    );
    await expect(notices(page).getByRole("button", { name: "Deshacer" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await pads(page).getByRole("button", { name: "Opciones de «Meditar»" }).click();
    const options = page.getByRole("dialog", { name: "Meditar" });
    await expect(options.getByRole("button", { name: "Archivar" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await options.getByRole("button", { name: "Editar" }).click();
    await expect(page.getByRole("dialog", { name: "Editar hábito" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Ordenar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Mover «Meditar»" })).toHaveAttribute(
      "aria-roledescription",
      "elemento ordenable",
    );
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`${theme} theme: "Hoy" with a weekly habit and "No tocan hoy" open (reference screenshot)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertHabit({ name: "Meditar 10 min", area: "health", done: true, sortOrder: 0 });
    await insertHabit({
      name: "Gimnasio",
      area: "health",
      weeklyTarget: 3,
      done: true,
      sortOrder: 1,
    });
    await insertHabit({ name: "Estirar", sortOrder: 2 });
    // Every weekday but today's: never due, whatever day the run is.
    const others = [1, 2, 3, 4, 5, 6, 7].filter((day) => day !== limaWeekday(0)).slice(0, 6);
    await insertHabit({ name: "Inglés", area: "learning", weekdays: others, sortOrder: 3 });
    await openHabits(page);
    await setTheme(page, theme);
    await expect(habitsCount(page)).toHaveText("2 de 3 hoy");
    await notDueToggle(page).click();
    await expect(notDuePads(page)).toBeVisible();
    await afterSaveSettled(page);
    await expectScreenshot(page.locator("main"), `habits-organize-${theme}.png`, {
      stylePath: SCREENSHOT_CSS,
    });
  });
}
