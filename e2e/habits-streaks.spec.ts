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
  readDay,
  readPauses,
  test,
} from "./support/habits";
import { isDesktop, limaDay, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// H4 of `habits`: the streak on the pad, pausing and resuming (with "En pausa"), logging
// yesterday from "Registrar otro día", 320 px, axe in both themes and the screenshots of "Hoy"
// with streaks and a paused habit. Every test holds the habits lock and starts from an empty
// "Hoy" (e2e/support/habits.ts).

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

/** The pad's streak line ("RACHA 3"). */
const streak = (page: Page, name: string) => pad(page, name).locator("[data-habit-streak]");
const pausedToggle = (page: Page) => page.getByRole("button", { name: /^En pausa/ });

async function openOptions(page: Page, name: string) {
  await page.getByRole("button", { name: `Opciones de «${name}»` }).click();
  return page.getByRole("dialog", { name });
}

test("the streak on the pad: RACHA 3, a tap makes it 4 at once and it is saved", async ({
  page,
}, testInfo) => {
  const name = unique("Leer", testInfo);
  await insertHabit({ name, doneDays: [-3, -2, -1] });
  await openHabits(page);
  await expect(streak(page, name)).toHaveAttribute("data-habit-streak", "RACHA 3");
  await untilSaved(page, () => pad(page, name).click());
  await expect(streak(page, name)).toHaveAttribute("data-habit-streak", "RACHA 4");
  await page.reload();
  await expect(streak(page, name)).toHaveAttribute("data-habit-streak", "RACHA 4");
});

test("pause from the options, then Reanudar; Deshacer pauses it again", async ({
  page,
}, testInfo) => {
  const name = unique("Gimnasio", testInfo);
  const other = unique("Leer", testInfo);
  const id = await insertHabit({ name, doneDays: [-1], sortOrder: 0 });
  await insertHabit({ name: other, sortOrder: 1 });
  await openHabits(page);
  await expect(habitsCount(page)).toHaveText("0 de 2 hoy");

  const options = await openOptions(page, name);
  await options.getByRole("button", { name: "Pausar" }).click();
  const sheet = page.getByRole("dialog", { name: `Pausar «${name}»` });
  await expect(sheet.getByLabel("Desde")).toBeFocused();
  await expect(sheet.getByLabel("Desde")).toHaveValue(limaDay(0));
  await expect(sheet.getByLabel("Hasta (incluido)")).toHaveValue(limaDay(6));
  await sheet.getByRole("textbox", { name: "Motivo (opcional)" }).fill("Viaje");
  await untilSaved(page, () => sheet.getByRole("button", { name: "Pausar" }).click());
  await expect(sheet).toBeHidden();
  await expect(notices(page).getByText(`«${name}» quedó en pausa hasta el`)).toBeVisible();
  // Out of the grid and the count, into "En pausa" (open, with focus on its "Reanudar").
  await expect(pads(page).getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(habitsCount(page)).toHaveText("0 de 1 hoy");
  await expect(pausedToggle(page)).toHaveAttribute("aria-expanded", "true");
  const resume = page.getByRole("button", { name: `Reanudar «${name}»` });
  await expect(resume).toBeFocused();
  await expect(page.getByText(/En pausa hasta el .* · Viaje/)).toBeVisible();
  await expect.poll(() => readPauses(id)).toEqual([{ startDate: limaDay(0), endDate: limaDay(6) }]);

  await untilSaved(page, () => resume.click());
  await expect(pad(page, name)).toBeFocused();
  await expect(habitsCount(page)).toHaveText("0 de 2 hoy");
  await expect(pausedToggle(page)).toHaveCount(0);
  // It started today: "Reanudar" removed it.
  await expect.poll(() => readPauses(id)).toEqual([]);
  await expect(notices(page).getByText(`«${name}» volvió a tus hábitos de hoy.`)).toBeVisible();
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect.poll(() => readPauses(id)).toEqual([{ startDate: limaDay(0), endDate: limaDay(6) }]);
  await expect(pausedToggle(page)).toBeVisible();
  await expect(habitsCount(page)).toHaveText("0 de 1 hoy");
});

test("Registrar otro día: yesterday marked from the options joins the streak", async ({
  page,
}, testInfo) => {
  const name = unique("Leer", testInfo);
  const id = await insertHabit({ name, doneDays: [-3, -2] });
  await openHabits(page);
  // Yesterday is open: no streak line yet.
  await expect(streak(page, name)).toHaveCount(0);

  const options = await openOptions(page, name);
  await options.getByRole("button", { name: "Registrar otro día" }).click();
  const sheet = page.getByRole("dialog", { name: `Registrar «${name}»` });
  const yesterday = sheet.getByRole("radio").first();
  await expect(yesterday).toHaveText("Ayer");
  await expect(yesterday).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByRole("radio")).toHaveCount(7);
  await sheet.getByRole("switch", { name: "Hecho ese día" }).click();
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar" }).click());
  await expect(sheet).toBeHidden();
  await expect(notices(page).getByText(new RegExp(`«${name}», .*: hecho\\.`))).toBeVisible();
  await expect.poll(() => readDay(id, -1)).toBe(1);
  // Today untouched; the streak counts the three days now.
  await expect(pad(page, name)).toHaveAttribute("aria-pressed", "false");
  await expect(streak(page, name)).toHaveAttribute("data-habit-streak", "RACHA 3");
  await expect.poll(() => readDay(id, 0)).toBeNull();
});

test("at 320 px the pause sheet and 'En pausa' don't scroll sideways @responsive", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await insertHabit({
    name: "Un hábito con un nombre bastante largo para la fila",
    pause: { start: -1, end: 30, reason: "x".repeat(60) },
  });
  await insertHabit({ name: "Leer", doneDays: [-1] });
  await page.setViewportSize({ width: 320, height: 640 });
  await openHabits(page);
  await pausedToggle(page).click();
  await expect(page.getByRole("button", { name: /^Reanudar/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const options = await openOptions(page, "Leer");
  await options.getByRole("button", { name: "Pausar" }).click();
  const sheet = page.getByRole("dialog", { name: "Pausar «Leer»" });
  await expect(sheet.getByLabel("Desde")).toBeFocused();
  const box = await sheet.getByLabel("Hasta (incluido)").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (streaks, En pausa, the sheets)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertHabit({ name: "Leer", area: "learning", doneDays: [-2, -1], sortOrder: 0 });
    await insertHabit({
      name: "Gimnasio",
      weeklyTarget: 3,
      doneDays: [-14, -13, -12, -7, -6, -5],
      startedDaysAgo: 30,
      sortOrder: 1,
    });
    await insertHabit({ name: "No fumar", kind: "avoid", sortOrder: 2 });
    await insertHabit({
      name: "Correr",
      area: "health",
      pause: { start: -2, end: 5, reason: "Gripe" },
      sortOrder: 3,
    });
    await openHabits(page);
    await setTheme(page, theme);
    await pausedToggle(page).click();
    expect(await axeViolations(page)).toEqual([]);
    // A tap, then the notice.
    await untilSaved(page, () => pad(page, "Leer").click());
    await expect(notices(page).getByRole("button", { name: "Deshacer" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    let options = await openOptions(page, "Correr");
    await expect(options.getByRole("button", { name: "Reanudar" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(options).toBeHidden();

    options = await openOptions(page, "Leer");
    await options.getByRole("button", { name: "Pausar" }).click();
    const sheet = page.getByRole("dialog", { name: "Pausar «Leer»" });
    await expect(sheet.getByLabel("Desde")).toBeFocused();
    await sheet.getByLabel("Hasta (incluido)").fill(limaDay(-1));
    await sheet.getByRole("button", { name: "Pausar" }).click();
    await expect(sheet.getByLabel("Hasta (incluido)")).toHaveAttribute("aria-invalid", "true");
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    options = await openOptions(page, "No fumar");
    await options.getByRole("button", { name: "Registrar otro día" }).click();
    const other = page.getByRole("dialog", { name: "Registrar «No fumar»" });
    await expect(other.getByRole("switch", { name: "Recaída ese día" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`${theme} theme: "Hoy" with streaks and a paused habit (reference screenshot) @responsive`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertHabit({
      name: "Leer",
      area: "learning",
      doneDays: [-3, -2, -1],
      done: true,
      sortOrder: 0,
    });
    await insertHabit({ name: "Meditar", area: "health", doneDays: [-2, -1], sortOrder: 1 });
    await insertHabit({
      name: "Gimnasio",
      area: "health",
      weeklyTarget: 1,
      doneDays: [-21, -14, -7],
      startedDaysAgo: 28,
      sortOrder: 2,
    });
    await insertHabit({ name: "No fumar", kind: "avoid", sortOrder: 3 });
    await insertHabit({
      name: "Correr",
      area: "health",
      pause: { start: -1, end: 5, reason: "Viaje" },
      sortOrder: 4,
    });
    await openHabits(page);
    await setTheme(page, theme);
    // Folded: its row says until when, a date that changes every day (the screenshot can't).
    await expect(pausedToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(habitsCount(page)).toHaveText("2 de 4 hoy");
    await afterSaveSettled(page);
    await expectScreenshot(page.locator("main"), `habits-streaks-${theme}.png`, {
      stylePath: SCREENSHOT_CSS,
    });
  });
}
