import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import {
  expect,
  insertHabit,
  openHabitPage,
  openHabits,
  openWeek,
  pads,
  readDay,
  readHabit,
  readHabitDetails,
  test,
} from "./support/habits";
import { isDesktop, limaDay, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// H5 of `habits`: "Semana" (the total, each habit's week, the week links), a habit's page (stats,
// the calendar as a grid, logging yesterday from it, "Más detalles", archive, delete back to "Hoy"
// with "Deshacer"), its 404, 320 px, axe in both themes and the screenshots of both screens (on
// fixed past dates, so they look the same every day). Every test holds the habits lock and starts
// from an empty "Hoy" (e2e/support/habits.ts).

const THEMES = ["dark", "light"] as const;
const SCREENSHOT_CSS = path.join(__dirname, "support/hide-app-nav.css");

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

/** A stat's figure as screen readers get it. */
const stat = (page: Page, name: string) =>
  page.locator(`[data-habit-stat="${name}"] .bo-stat__value .sr-only`);
const dayKey = (page: Page, day: string) => page.locator(`[data-day="${day}"]`);

/**
 * A fixed week (Monday 9 March 2026) and month, so "Semana" and the page look the same every
 * day: 18 de 26 that week; the best streak of "Leer" is 6 (across its pause).
 */
async function insertFixedHabits() {
  const startDate = "2026-03-02";
  const leer = await insertHabit({
    name: "Leer",
    area: "learning",
    startDate,
    identity: "Soy alguien que lee",
    cue: "Antes de dormir",
    logs: [
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
      "2026-03-19",
      "2026-03-20",
      "2026-03-21",
    ].map((day) => ({ day })),
    pauses: [{ startDate: "2026-03-16", endDate: "2026-03-18", reason: "Viaje" }],
    sortOrder: 0,
  });
  await insertHabit({
    name: "Agua",
    area: "health",
    startDate,
    quantity: { goal: 8, unit: "vasos" },
    logs: [
      { day: "2026-03-09", quantity: 8 },
      { day: "2026-03-10", quantity: 5 },
      { day: "2026-03-11", quantity: 8 },
      { day: "2026-03-12", quantity: 2 },
    ],
    sortOrder: 1,
  });
  await insertHabit({
    name: "Gimnasio",
    area: "health",
    startDate,
    weeklyTarget: 3,
    logs: [{ day: "2026-03-10" }, { day: "2026-03-12" }],
    sortOrder: 2,
  });
  await insertHabit({
    name: "Inglés",
    area: "learning",
    startDate,
    weekdays: [1, 3, 5],
    logs: [{ day: "2026-03-09" }, { day: "2026-03-13" }],
    pauses: [{ startDate: "2026-03-11", endDate: "2026-03-11" }],
    sortOrder: 3,
  });
  await insertHabit({
    name: "No fumar",
    kind: "avoid",
    startDate,
    logs: [{ day: "2026-03-12" }],
    sortOrder: 4,
  });
  await insertHabit({ name: "Ajedrez", area: "learning", archived: true, sortOrder: 5 });
  return { leer };
}

test("Semana: the week's total, each habit's compliance and the week links", async ({ page }) => {
  await insertFixedHabits();
  await openWeek(page, "2026-03-11");
  // The view switch marks "Semana".
  const views = page.getByRole("navigation", { name: "Vistas de hábitos" });
  await expect(views.getByRole("link", { name: "Semana" })).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle("Semana · Hábitos · brahua-os");
  const total = page.locator("[data-week-total]");
  await expect(total.locator(".bo-stat__value .sr-only")).toHaveText("18");
  await expect(total).toContainText("de 26");
  await expect(total).toContainText("Del 9 al 15 de marzo");
  const compliance = (name: string) =>
    page
      .locator("[data-habit-week]", { has: page.getByRole("link", { name, exact: true }) })
      .locator("[data-week-compliance] [aria-hidden]");
  await expect(compliance("Leer")).toHaveText("6 de 7");
  await expect(compliance("Agua")).toHaveText("2 de 7");
  await expect(compliance("Gimnasio")).toHaveText("2 de 3");
  await expect(compliance("Inglés")).toHaveText("2 de 2");
  await expect(compliance("No fumar")).toHaveText("6 de 7");
  // The archived one is only in "Archivados".
  await expect(page.locator("[data-habit-week]")).toHaveCount(5);
  await expect(page.getByRole("button", { name: /^Archivados/ })).toContainText("1");

  await page.getByRole("link", { name: "Semana anterior" }).click();
  await expect(page).toHaveURL(/semana=2026-03-02/);
  await expect(page.locator("[data-week-total]")).toContainText("Del 2 al 8 de marzo");
  // The first week of the habits: nothing before it.
  await expect(page.getByRole("link", { name: "Semana anterior" })).toHaveCount(0);
  await page.getByRole("link", { name: "Semana siguiente" }).click();
  await expect(page).toHaveURL(/semana=2026-03-09/);
  await page.getByRole("link", { name: "Volver a esta semana" }).click();
  await expect(page.locator("[data-week-total]")).toContainText("esta semana");
  await expect(page.getByRole("link", { name: "Semana siguiente" })).toHaveCount(0);
  // And back to "Hoy".
  await views.getByRole("link", { name: "Hoy" }).click();
  await expect(page).toHaveURL(/\/habits$/);
  await expect(pads(page)).toBeVisible();
});

test("the page's calendar: yesterday logged from it joins the streak; arrows move by day", async ({
  page,
}, testInfo) => {
  const name = unique("Leer", testInfo);
  const id = await insertHabit({ name, doneDays: [-3, -2], startedDaysAgo: 20 });
  const yesterday = limaDay(-1);
  await openHabitPage(page, id, yesterday.slice(0, 7));
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(stat(page, "current")).toHaveText("0");
  await expect(stat(page, "best")).toHaveText("2");
  const key = dayKey(page, yesterday);
  await expect(key).toHaveAccessibleName(/: sin marcar$/);
  await key.click();
  const sheet = page.getByRole("dialog", { name: `Registrar «${name}»` });
  await expect(sheet.getByRole("radio", { name: /^Ayer/ })).toHaveAttribute("aria-checked", "true");
  await sheet.getByRole("switch", { name: "Hecho ese día" }).click();
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar" }).click());
  await expect(sheet).toBeHidden();
  await expect(notices(page).getByText(new RegExp(`«${name}», .*: hecho\\.`))).toBeVisible();
  await expect.poll(() => readDay(id, -1)).toBe(1);
  await expect(key).toHaveAccessibleName(/: hecho$/);
  await expect(stat(page, "current")).toHaveText("3");
  await expect(key).toBeFocused();
  // The grid: one tab stop, arrows by day (yesterday → the day before).
  await page.keyboard.press("ArrowLeft");
  // Yesterday the 1st: the day before is in another month, so focus stays.
  await expect(yesterday.endsWith("-01") ? key : dayKey(page, limaDay(-2))).toBeFocused();
  await page.reload();
  await expect(stat(page, "current")).toHaveText("3");
});

test("from the options to the page; Más detalles when editing; Archivar and Reactivar", async ({
  page,
}, testInfo) => {
  const name = unique("Meditar", testInfo);
  const id = await insertHabit({ name, sortOrder: 0 });
  await openHabits(page);
  await pads(page)
    .getByRole("button", { name: `Opciones de «${name}»` })
    .click();
  await page
    .getByRole("dialog", { name })
    .getByRole("link", { name: "Ver historial y detalles" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/habits/${id}$`));
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");

  await page.getByRole("button", { name: "Editar" }).click();
  const form = page.getByRole("dialog", { name: "Editar hábito" });
  await form.getByRole("button", { name: /Más detalles/ }).click();
  await form.getByRole("textbox", { name: "Identidad (opcional)" }).fill("Soy alguien que medita");
  await form.getByRole("textbox", { name: "Momento (opcional)" }).fill("Después del desayuno");
  // Editing never changes the start date.
  await expect(form.getByLabel("Fecha de inicio")).toHaveCount(0);
  await untilSaved(page, () => form.getByRole("button", { name: "Guardar cambios" }).click());
  await expect(form).toBeHidden();
  await expect(page.locator("[data-habit-identity]")).toHaveText("Soy alguien que medita");
  await expect(page.locator("[data-habit-cue]")).toHaveText("Después del desayuno");
  await expect
    .poll(async () => (await readHabitDetails(id)).identity)
    .toBe("Soy alguien que medita");

  const archive = page.getByRole("button", { name: "Archivar" });
  await untilSaved(page, () => archive.click());
  await expect(page.getByRole("button", { name: "Reactivar" })).toBeFocused();
  await expect(page.locator("[data-habit-archived]")).toBeVisible();
  await expect.poll(async () => (await readHabit(id)).archivedAt).not.toBeNull();
  await untilSaved(page, () => page.getByRole("button", { name: "Reactivar" }).click());
  await expect(page.getByRole("button", { name: "Archivar" })).toBeFocused();
  await expect.poll(async () => (await readHabit(id)).archivedAt).toBeNull();
});

test("create with Más detalles: identity and a start date three days back", async ({
  page,
}, testInfo) => {
  const name = unique("Escribir", testInfo);
  await openHabits(page);
  await page.getByRole("button", { name: "Nuevo hábito" }).first().click();
  const form = page.getByRole("dialog", { name: "Nuevo hábito" });
  await form.getByRole("textbox", { name: "Nombre" }).fill(name);
  await form.getByRole("button", { name: /Más detalles/ }).click();
  await form.getByRole("textbox", { name: "Identidad (opcional)" }).fill("Soy alguien que escribe");
  await form.getByLabel("Fecha de inicio").fill(limaDay(-3));
  await untilSaved(page, () => form.getByRole("button", { name: "Crear hábito" }).click());
  await expect(form).toBeHidden();
  await pads(page)
    .getByRole("button", { name: `Opciones de «${name}»` })
    .click();
  await page
    .getByRole("dialog", { name })
    .getByRole("link", { name: "Ver historial y detalles" })
    .click();
  await expect(page.locator("[data-habit-identity]")).toHaveText("Soy alguien que escribe");
  const id = page.url().split("/").pop()!.split("?")[0];
  await expect.poll(async () => (await readHabitDetails(id)).startDate).toBe(limaDay(-3));
});

test("Eliminar from the page asks first, then back to Hoy with Deshacer; its page is a 404", async ({
  page,
}, testInfo) => {
  const name = unique("Correr", testInfo);
  const id = await insertHabit({ name, loggedBefore: true });
  await openHabitPage(page, id);
  await page.getByRole("button", { name: "Eliminar hábito" }).click();
  await expect(page.getByRole("heading", { level: 3, name: `¿Eliminar «${name}»?` })).toBeFocused();
  await page.getByRole("button", { name: "Sí, eliminar" }).click();
  await expect(page).toHaveURL(/\/habits$/);
  await expect(page.getByRole("heading", { level: 1, name: "Hábitos" })).toBeFocused();
  await expect(notices(page).getByText(`«${name}» se eliminó.`)).toBeVisible();
  await expect.poll(async () => (await readHabit(id)).deletedAt).not.toBeNull();

  await page.goto(`/habits/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Este hábito no está" })).toBeVisible();
  await expect(page).toHaveTitle("Hábito no encontrado · brahua-os");
  await page.goto("/habits/not-a-uuid");
  await expect(page.getByRole("heading", { level: 1, name: "Este hábito no está" })).toBeVisible();
  // Deshacer brings it back.
  await page.goto(`/habits?deleted=${id}`);
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect.poll(async () => (await readHabit(id)).deletedAt).toBeNull();
});

test("at 320 px, Semana and the page don't scroll sideways", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const { leer } = await insertFixedHabits();
  await page.setViewportSize({ width: 320, height: 640 });
  await openWeek(page, "2026-03-09");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await openHabitPage(page, leer, "2026-03");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const box = await dayKey(page, "2026-03-29").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (Semana, the page, its sheets)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { leer } = await insertFixedHabits();
    const estirar = await insertHabit({
      name: "Estirar",
      area: "health",
      doneDays: [-2, -1],
      pause: { start: 3, end: 5, reason: "Viaje" },
      sortOrder: 6,
    });
    await openWeek(page, "2026-03-09");
    await setTheme(page, theme);
    await page.getByRole("button", { name: /^Archivados/ }).click();
    expect(await axeViolations(page)).toEqual([]);

    await openHabitPage(page, leer, "2026-03");
    await page.getByRole("button", { name: /^Pausas pasadas/ }).click();
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Editar" }).click();
    const form = page.getByRole("dialog", { name: "Editar hábito" });
    await expect(form.getByRole("textbox", { name: "Identidad (opcional)" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();

    // Today's month: a day of the last 7 opens the sheet; a planned pause with "Cancelar".
    await openHabitPage(page, estirar);
    await expect(page.getByRole("button", { name: /^Cancelar la pausa/ })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.locator('[data-day][aria-current="date"]').click();
    const sheet = page.getByRole("dialog", { name: "Registrar «Estirar»" });
    await expect(sheet.getByRole("switch", { name: "Hecho ese día" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`${theme} theme: Semana on a fixed week (reference screenshot)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertFixedHabits();
    await openWeek(page, "2026-03-09");
    await setTheme(page, theme);
    await expect(page.locator("[data-habit-week]")).toHaveCount(5);
    await afterSaveSettled(page);
    await expectScreenshot(page.locator("main"), `habits-week-${theme}.png`, {
      stylePath: SCREENSHOT_CSS,
    });
  });

  test(`${theme} theme: a habit's page on a fixed month (reference screenshot)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { leer } = await insertFixedHabits();
    await openHabitPage(page, leer, "2026-03");
    await setTheme(page, theme);
    await expect(stat(page, "best")).toHaveText("6");
    await afterSaveSettled(page);
    await expectScreenshot(page.locator("main"), `habits-detail-${theme}.png`, {
      stylePath: SCREENSHOT_CSS,
    });
  });
}
