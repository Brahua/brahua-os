import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import {
  expect,
  habitsCount,
  insertHabit,
  openHabits,
  pad,
  pads,
  readHabit,
  readHabitByName,
  test,
} from "./support/habits";
import { isDesktop, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// H1 of `habits`: create, one-tap logging with "Deshacer", delete and undo, the provisional
// navigation, axe in both themes and the "Hoy" screenshots. Every test holds the habits lock and
// starts from an empty "Hoy" (e2e/support/habits.ts), so the grid and its count are its own.

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

test("navigation: Hábitos after the capture key on the phone, shortcut 4 on the desktop", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  if (isDesktop(testInfo)) {
    await page.keyboard.press("4");
  } else {
    await page.locator(".bo-bottomnav--fixed").getByRole("link", { name: "Hábitos" }).click();
  }
  await expect(page).toHaveURL("/habits");
  await expect(page).toHaveTitle("Hábitos · brahua-os");
  await expect(page.getByRole("link", { name: "Hábitos" }).filter({ visible: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("empty: an explanation and a key to create the first habit", async ({ page }) => {
  await openHabits(page);
  await expect(page.getByRole("heading", { level: 2, name: "Todavía no tienes hábitos" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear un hábito" })).toBeVisible();
  await expect(habitsCount(page)).toHaveCount(0);
});

test("create a habit with an area: its pad is focused, last, and counted", async ({
  page,
}, testInfo) => {
  await insertHabit({ name: unique("Antes", testInfo) });
  const name = unique("Meditar", testInfo);
  await openHabits(page);
  await page.getByRole("button", { name: "Nuevo hábito" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo hábito" });
  const field = sheet.getByRole("textbox", { name: "Nombre" });
  await expect(field).toBeFocused();
  await field.fill(name);
  await sheet.getByRole("radio", { name: "Salud y Bienestar" }).click();
  await untilSaved(page, () => sheet.getByRole("button", { name: "Crear hábito" }).click());
  await expect(sheet).toBeHidden();
  await expect(pad(page, name)).toBeFocused();
  await expect(pad(page, name)).toHaveAttribute("aria-pressed", "false");
  await expect(habitsCount(page)).toHaveText("0 de 2 hoy");
  // New habits go last.
  await expect(pads(page).locator("[data-habit-pad]").last()).toHaveAccessibleName(name);
  expect(await readHabitByName(name)).toMatchObject({ deletedAt: null, areaId: expect.any(String) });
});

test("one tap marks today in under 2 s; Deshacer (⌘Z on the desktop) unmarks it", async ({
  page,
}, testInfo) => {
  const name = unique("Leer", testInfo);
  const id = await insertHabit({ name, area: "learning" });
  await insertHabit({ name: unique("Otro", testInfo) });
  await openHabits(page);
  await expect(habitsCount(page)).toHaveText("0 de 2 hoy");

  const started = Date.now();
  await untilSaved(page, () => pad(page, name).click());
  // Saved on the server within 2 s of the tap (SPEC-habits "Un toque").
  expect(Date.now() - started).toBeLessThan(2_000);
  await expect(pad(page, name)).toHaveAttribute("aria-pressed", "true");
  await expect(habitsCount(page)).toHaveText("1 de 2 hoy");
  await expect(notices(page).getByText(`«${name}» quedó hecho hoy.`)).toBeVisible();
  expect((await readHabit(id)).today).toBe(1);

  if (isDesktop(testInfo)) {
    await untilSaved(page, () => page.keyboard.press("ControlOrMeta+z"));
  } else {
    await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  }
  await expect(pad(page, name)).toHaveAttribute("aria-pressed", "false");
  await expect(habitsCount(page)).toHaveText("0 de 2 hoy");
  // Unmarked keeps its row with 0 (never deleted).
  expect((await readHabit(id)).today).toBe(0);

  // A done pad unmarks with a tap too; it survives a reload.
  await untilSaved(page, () => pad(page, name).click());
  await page.reload();
  await expect(pad(page, name)).toHaveAttribute("aria-pressed", "true");
});

test("delete asks first when it has logs; Deshacer brings it back with them", async ({
  page,
}, testInfo) => {
  const name = unique("Correr", testInfo);
  const id = await insertHabit({ name, done: true, loggedBefore: true });
  const next = unique("Agua", testInfo);
  await insertHabit({ name: next, sortOrder: 5_000 });
  await openHabits(page);
  await pads(page).getByRole("button", { name: `Opciones de «${name}»` }).click();
  const sheet = page.getByRole("dialog", { name });
  await sheet.getByRole("button", { name: "Eliminar hábito" }).click();
  await expect(sheet.getByRole("heading", { name: `¿Eliminar «${name}»?` })).toBeFocused();
  await untilSaved(page, () => sheet.getByRole("button", { name: "Sí, eliminar" }).click());
  await expect(sheet).toBeHidden();
  await expect(pad(page, name)).toHaveCount(0);
  // Focus goes to the neighbor's pad, never to <body>.
  await expect(pad(page, next)).toBeFocused();
  await expect(notices(page).getByText(`«${name}» se eliminó.`)).toBeVisible();
  expect((await readHabit(id)).deletedAt).not.toBeNull();

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(pad(page, name)).toHaveAttribute("aria-pressed", "true");
  expect(await readHabit(id)).toMatchObject({ deletedAt: null, today: 1 });
  await page.reload();
  await expect(pad(page, name)).toBeVisible();
});

test("at 320 px the pads don't scroll sideways", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await insertHabit({ name: "Un hábito con un nombre bastante largo para una pantalla angosta" });
  await insertHabit({ name: "Leer", done: true });
  await page.setViewportSize({ width: 320, height: 640 });
  await openHabits(page);
  await expect(pads(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (empty, Hoy, the form with an error, delete)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHabits(page);
    await setTheme(page, theme);
    expect(await axeViolations(page)).toEqual([]);

    await insertHabit({ name: "Meditar", area: "health", done: true, sortOrder: 0 });
    await insertHabit({ name: "Leer 20 páginas", area: "learning", sortOrder: 1 });
    await insertHabit({ name: "Estirar", sortOrder: 2 });
    await page.reload();
    await expect(pads(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    // A tap, then the notice.
    await untilSaved(page, () => pad(page, "Estirar").click());
    await expect(notices(page).getByRole("button", { name: "Deshacer" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Nuevo hábito" }).click();
    const form = page.getByRole("dialog", { name: "Nuevo hábito" });
    await form.getByRole("button", { name: "Crear hábito" }).click();
    await expect(form.getByRole("textbox", { name: "Nombre" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();

    await pads(page).getByRole("button", { name: "Opciones de «Meditar»" }).click();
    const options = page.getByRole("dialog", { name: "Meditar" });
    await options.getByRole("button", { name: "Eliminar hábito" }).click();
    await expect(options.getByRole("button", { name: "Sí, eliminar" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`${theme} theme: "Hoy" (reference screenshot)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertHabit({ name: "Meditar 10 min", area: "health", done: true, sortOrder: 0 });
    await insertHabit({ name: "Leer 20 páginas", area: "learning", sortOrder: 1 });
    await insertHabit({ name: "Revisar finanzas", area: "finance", done: true, sortOrder: 2 });
    await insertHabit({ name: "Estirar", sortOrder: 3 });
    await openHabits(page);
    await setTheme(page, theme);
    await expect(habitsCount(page)).toHaveText("2 de 4 hoy");
    await afterSaveSettled(page);
    await expectScreenshot(page.locator("main"), `habits-today-${theme}.png`, {
      stylePath: SCREENSHOT_CSS,
    });
  });
}
