import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { expect, insertHabit } from "./support/habits";
import { expectNoOverflow, isDesktop, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { boardTest as test, insertTodayTask } from "./support/today-tasks";

// D4 of `today` (SPEC-today): "Día completo" at the top of "/" when every habit due today is done,
// no task is left and something was done today. Every test is a `boardTest`
// (e2e/support/today-tasks.ts): it holds the habits and tasks locks and starts with no habits, no
// task due today or before and no task completed today, so the day is only what the test makes
// (the fixed projects of global-setup may show: they never count). No screenshot: the line of the
// day changes every day.

const THEMES = ["dark", "light"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

/** Opens "/" and waits until it is hydrated (taps reach React) and laid out (fonts in). */
async function openToday(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle("Hoy · brahua-os");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

async function axeViolations(page: Page) {
  await afterSaveSettled(page);
  return (await new AxeBuilder({ page }).analyze()).violations;
}

const complete = (page: Page) => page.getByRole("region", { name: "Día completo" });
const achieved = (page: Page) => page.locator("[data-today-complete-achieved]");
const check = (page: Page, title: string) =>
  page.getByRole("region", { name: "Tareas" }).getByRole("checkbox", { name: `Hecha: ${title}` });
const pad = (page: Page, name: string) =>
  page.getByRole("list", { name: "Hábitos de hoy" }).getByRole("button", { name, exact: true });
const announcer = (page: Page) => page.locator("[data-screen-announcer]");

const unique = (prefix: string, testInfo: TestInfo) =>
  `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 6)}`;

/** One habit already done and one task due today: completing the task closes the day. */
async function almostDone(testInfo: TestInfo) {
  await insertHabit({ name: "Leer", done: true, sortOrder: 0 });
  const title = unique("Enviar informe", testInfo);
  await insertTodayTask({ title, due: 0 });
  return title;
}

test("completing the last task shows Día completo at once; Deshacer takes it away", async ({
  page,
}, testInfo) => {
  const title = await almostDone(testInfo);
  await openToday(page);
  await expect(complete(page)).toHaveCount(0);

  await untilSaved(page, () => check(page, title).click());
  await expect(complete(page)).toBeVisible();
  await expect(complete(page).getByRole("heading", { level: 2 })).toHaveText("Día completo");
  await expect(achieved(page)).toHaveText("Logrado hoy: 1 hábito · 1 tarea");
  // Announced once, through the board's announcer; it never takes focus (the greeting has it:
  // the section left with its last row).
  await expect(announcer(page)).toHaveText("Día completo: 1 hábito y 1 tarea.");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  // On top of the board, first.
  await expect(page.locator("[data-today-board] > *").first()).toHaveAttribute(
    "data-today-complete",
    "",
  );

  // Deshacer: the task is pending again and the block leaves at once.
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(complete(page)).toHaveCount(0);
  await expect(check(page, title)).toBeVisible();
  await afterSaveSettled(page);
  await expect(complete(page)).toHaveCount(0);

  // Again, then a fresh load: the server's read says the day is complete (no fade, no
  // announcement: it wasn't live).
  await untilSaved(page, () => check(page, title).click());
  await expect(complete(page)).toBeVisible();
  await openToday(page);
  await expect(complete(page)).toBeVisible();
  await expect(achieved(page)).toHaveText("Logrado hoy: 1 hábito · 1 tarea");
  // Not live: no fade (not being announced on load is covered by the unit tests).
  await expect(complete(page)).not.toHaveAttribute("data-appeared");
});

test("the last habit closes the day too, and undoing it reopens it", async ({ page }, testInfo) => {
  const name = unique("Meditar", testInfo);
  await insertHabit({ name, sortOrder: 0 });
  await insertHabit({ name: "Leer", done: true, sortOrder: 1 });
  await openToday(page);
  await expect(complete(page)).toHaveCount(0);

  await untilSaved(page, () => pad(page, name).click());
  await expect(complete(page)).toBeVisible();
  await expect(achieved(page)).toHaveText("Logrado hoy: 2 hábitos");
  // Focus stays on the pad.
  await expect(pad(page, name)).toBeFocused();

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(complete(page)).toHaveCount(0);
});

test("a day without activity: never Día completo (positive control: one task done)", async ({
  page,
}, testInfo) => {
  // Nothing at all (only the fixed projects, which never count).
  await openToday(page);
  await expect(page.locator("[data-today-board]")).toBeVisible();
  await expect(complete(page)).toHaveCount(0);

  // A habit to avoid kept clean counts as done ("1 de 1"), but it isn't activity.
  await insertHabit({ name: unique("No fumar", testInfo), kind: "avoid" });
  await openToday(page);
  await expect(page.locator("[data-today-habits-count]")).toHaveText("1 de 1 cumplidos");
  await expect(complete(page)).toHaveCount(0);

  // Positive control: a task completed today is activity.
  const title = unique("Llamar al banco", testInfo);
  await insertTodayTask({ title, due: 0 });
  await openToday(page);
  await expect(complete(page)).toHaveCount(0);
  await untilSaved(page, () => check(page, title).click());
  await expect(complete(page)).toBeVisible();
  await expect(achieved(page)).toHaveText("Logrado hoy: 1 hábito · 1 tarea");
});

test("it fades in (opacity) when it appears live; with reduced motion, no animation", async ({
  page,
}, testInfo) => {
  const animationOf = () =>
    complete(page).evaluate((element) => getComputedStyle(element).animationName);

  // Positive control: without reduced motion it fades in.
  const title = await almostDone(testInfo);
  await openToday(page);
  await untilSaved(page, () => check(page, title).click());
  await expect(complete(page)).toBeVisible();
  expect(await animationOf()).toBe("bo-fade-in");
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(complete(page)).toHaveCount(0);
  await afterSaveSettled(page);

  // The same, live again, with reduced motion.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openToday(page);
  await untilSaved(page, () => check(page, title).click());
  await expect(complete(page)).toBeVisible();
  expect(await animationOf()).toBe("none");
  // Fully there at once, and nothing in the board moves (only opacity was ever animated).
  expect(await complete(page).evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  expect(await complete(page).evaluate((element) => getComputedStyle(element).transform)).toBe(
    "none",
  );
});

test("at 320 px it fits without scrolling sideways @responsive", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await page.setViewportSize({ width: 320, height: 640 });
  await insertHabit({ name: "Un hábito con un nombre largo", done: true, sortOrder: 0 });
  await insertHabit({ name: "Otro hábito cumplido", done: true, sortOrder: 1 });
  const title = unique("Una tarea con un título bastante largo para el celular", testInfo);
  await insertTodayTask({ title, due: 0 });
  await openToday(page);
  await untilSaved(page, () => check(page, title).click());
  await expect(complete(page)).toBeVisible();
  await afterSaveSettled(page);
  await expectNoOverflow(page, complete(page));
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations with Día completo`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const title = await almostDone(testInfo);
    await openToday(page);
    await setTheme(page, theme);
    // Live, with the notice of the completion on screen.
    await untilSaved(page, () => check(page, title).click());
    await expect(complete(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    // Loaded already complete.
    await openToday(page);
    await expect(complete(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("postponing the last pending task with a habit done shows Día completo without counting the task; with no activity it does not (decision to review with the owner)", async ({
  page,
}, testInfo) => {
  // No activity at all: a postponed task is not something done.
  const alone = unique("Sin actividad", testInfo);
  await insertTodayTask({ title: alone, due: 0 });
  await openToday(page);
  await untilSaved(page, () =>
    page
      .getByRole("region", { name: "Tareas" })
      .getByRole("button", { name: `Pasar a mañana: ${alone}` })
      .click(),
  );
  await expect(page.getByRole("region", { name: "Tareas" })).toHaveCount(0);
  await afterSaveSettled(page);
  await expect(complete(page)).toHaveCount(0);

  // Positive control: with a habit done, the same move closes the day, and only the habit is
  // "logrado". Deshacer reopens it.
  await insertHabit({ name: "Leer", done: true, sortOrder: 0 });
  const title = unique("Enviar informe", testInfo);
  await insertTodayTask({ title, due: 0 });
  await openToday(page);
  await expect(complete(page)).toHaveCount(0);
  await untilSaved(page, () =>
    page
      .getByRole("region", { name: "Tareas" })
      .getByRole("button", { name: `Pasar a mañana: ${title}` })
      .click(),
  );
  await expect(complete(page)).toBeVisible();
  await expect(achieved(page)).toHaveText("Logrado hoy: 1 hábito");

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(complete(page)).toHaveCount(0);
  await expect(check(page, title)).toBeVisible();
});
