import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import {
  BENCH,
  expect,
  hydrated,
  insertOpenSession,
  insertRoutine,
  linkHabit,
  openHealth,
  readSessions,
  readSettings,
  SQUAT,
  test,
} from "./support/health";
import { insertHabit, pad, readDay } from "./support/habits";
import { isDesktop, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// E4 of `health`: the module's ONE E2E spec (CI budget). The way the owner uses it: a routine
// built on /health with two exercises from the seeded catalogue, the habit «Gimnasio» linked in
// «Ajustes»; on Hoy, «Empezar Rutina A» (the habit is due); sets marked in one tap with the rest
// bar; Hoy says «Entreno en curso» while it is open; «Terminar» marks the habit («Marcaste
// «Gimnasio».»); a second session that beats the first gives «1 récord nuevo». Axe in both themes
// on Hoy (both cards) and /health (with «Ajustes»); 320 px without sideways scroll; one screenshot
// (the «Entreno» section). Every test is a board test that starts and ends with no routines,
// sessions or settings (e2e/support/health.ts).

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

/** Opens Hoy and waits until it is hydrated. */
async function openToday(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await hydrated(page);
}

const training = (page: Page) => page.getByRole("region", { name: "Entreno" });
const setName = (index: number, exercise: string) => `Serie ${index + 1} de ${exercise}`;

const restBar = (page: Page) => page.getByRole("region", { name: "Descanso entre series" });

/**
 * Types the first set's weight and reps and marks it done (one tap): the rest bar starts; «Saltar»
 * ends it (so it never covers the next set's keys).
 */
async function markSet(page: Page, exercise: string, weight: string, reps: string) {
  const name = setName(0, exercise);
  await page.getByRole("textbox", { name: `${name}: peso en kg` }).fill(weight);
  await page.getByRole("textbox", { name: `${name}: repeticiones` }).fill(reps);
  await untilSaved(page, () => page.getByRole("checkbox", { name: `${name} hecha` }).click());
  await expect(page.getByRole("checkbox", { name: `${name} hecha` })).toBeChecked();
  // The done-save has settled: the next navigation can't drop it.
  await expect(page.locator("[data-saving]")).toHaveCount(0);
  await expect(restBar(page)).toBeVisible();
  await restBar(page).getByRole("button", { name: "Saltar el descanso" }).click();
  await expect(restBar(page)).toBeHidden();
}

/** «Terminar» and its sheet's «Terminar». */
async function finish(page: Page) {
  await page.getByRole("button", { name: "Terminar", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Terminar la sesión" });
  await untilSaved(page, () =>
    sheet.getByRole("button", { name: "Terminar", exact: true }).click(),
  );
  await expect(sheet).toBeHidden();
  await expect(notices(page).getByText("Sesión terminada")).toBeVisible();
}

test("a routine, the linked habit, a session from Hoy with the rest bar, the habit marked and a record", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const habitId = await insertHabit({ name: "Gimnasio" });

  // /health: «Nueva rutina» opens «Rutina A»; two exercises from the catalogue.
  await openHealth(page);
  await page.getByRole("button", { name: "Nueva rutina" }).click();
  await page.waitForURL(/\/health\/routines\//);
  await expect(page.getByRole("heading", { level: 1, name: "Rutina A" })).toBeVisible();
  for (const exercise of [SQUAT, BENCH]) {
    await page.getByRole("button", { name: "Agregar ejercicio" }).first().click();
    const picker = page.getByRole("dialog", { name: "Agregar ejercicio" });
    await picker.getByRole("searchbox", { name: "Buscar en el catálogo" }).fill(exercise.name);
    await untilSaved(page, () =>
      picker.getByRole("button", { name: `Agregar «${exercise.name}»` }).click(),
    );
    await expect(picker).toBeHidden();
    // Announced (not a notice), and the row is in the routine's list.
    await expect(page.locator("[data-screen-announcer]")).toHaveText(
      `Se agregó «${exercise.name}».`,
    );
    await expect(
      page.getByRole("list", { name: "Ejercicios de la rutina" }).getByText(exercise.name),
    ).toBeVisible();
  }
  await afterSaveSettled(page);

  // «Ajustes»: «Al terminar una sesión, marcar el hábito Gimnasio».
  await openHealth(page);
  await page.getByRole("button", { name: /^Ajustes/ }).click();
  const settings = page.getByRole("dialog", { name: "Ajustes de Entreno" });
  await settings
    .getByRole("combobox", { name: "Al terminar una sesión, marcar el hábito" })
    .selectOption({ label: "Gimnasio" });
  await untilSaved(page, () => settings.getByRole("button", { name: "Guardar" }).click());
  await expect(settings).toBeHidden();
  await expect(
    notices(page).getByText("Al terminar una sesión se marcará «Gimnasio»."),
  ).toBeVisible();
  expect((await readSettings())?.habitId).toBe(habitId);

  // Hoy: the habit is due, so «Entreno» offers the routine that comes next.
  await openToday(page);
  await expect(training(page).getByText("Te toca entrenar")).toBeVisible();
  await untilSaved(page, () =>
    training(page).getByRole("button", { name: "Empezar Rutina A" }).click(),
  );
  await page.waitForURL(/\/health\/sessions\//);
  await expect(page.getByRole("heading", { level: 1, name: "Rutina A" })).toBeVisible();

  // One tap marks a set; the rest bar starts (and «Saltar» ends it).
  await markSet(page, SQUAT.name, "60", "8");
  await markSet(page, BENCH.name, "40", "8");

  // Hoy while it is open: «Entreno en curso» with «Seguir», back to the session.
  await openToday(page);
  await expect(training(page).getByText("Entreno en curso")).toBeVisible();
  await training(page).getByRole("link", { name: "Seguir con Rutina A" }).click();
  await page.waitForURL(/\/health\/sessions\//);
  await expect(
    page.getByRole("checkbox", { name: `${setName(0, SQUAT.name)} hecha` }),
  ).toBeChecked();

  // «Terminar» marks «Gimnasio» today, and says so.
  await finish(page);
  await expect(notices(page).getByText(/Marcaste «Gimnasio»\./)).toBeVisible();
  expect(await readDay(habitId, 0)).toBe(1);
  const [first] = await readSessions();
  expect(first.endedAt).not.toBeNull();
  expect(first.habitMarkedDay).not.toBeNull();

  // Hoy: the habit is done, so «Entreno» doesn't show.
  await openToday(page);
  await expect(pad(page, "Gimnasio")).toHaveAttribute("aria-pressed", "true");
  await expect(training(page)).toHaveCount(0);

  // A second session from /health beats the first: 60 × 10 against 60 × 8 is one record (the
  // estimated 1RM; the weight ties), and the press ties.
  await openHealth(page);
  await untilSaved(page, () => page.getByRole("button", { name: "Empezar Rutina A" }).click());
  await page.waitForURL(/\/health\/sessions\//);
  await expect(
    page.getByRole("textbox", { name: `${setName(0, SQUAT.name)}: peso en kg` }),
  ).toHaveValue("60");
  await markSet(page, SQUAT.name, "60", "10");
  await markSet(page, BENCH.name, "40", "8");
  await finish(page);
  await expect(notices(page).getByText(/1 récord nuevo/)).toBeVisible();
  // The habit was already done today: nothing marked this time.
  await expect(notices(page).getByText(/Marcaste/)).toHaveCount(0);
  await expect(page.locator("[data-session-summary]")).toContainText("1 récord nuevo");
  const sessions = await readSessions();
  expect(sessions).toHaveLength(2);
  expect(sessions[1].habitMarkedDay).toBeNull();
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (Hoy's «Entreno», /health with «Ajustes»)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const habitId = await insertHabit({ name: "Gimnasio" });
    const routineId = await insertRoutine("Rutina A", [SQUAT.seedKey, BENCH.seedKey]);
    await linkHabit(habitId);

    // «Empezar Rutina A».
    await openToday(page);
    await setTheme(page, theme);
    await expect(training(page).getByRole("button", { name: "Empezar Rutina A" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // «Entreno en curso».
    await insertOpenSession(routineId);
    await openToday(page);
    await expect(training(page).getByText("Entreno en curso")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // /health with the open session and «Ajustes», and its sheet.
    await openHealth(page);
    await expect(page.getByRole("button", { name: /^Ajustes/ })).toContainText("«Gimnasio»");
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: /^Ajustes/ }).click();
    await expect(page.getByRole("dialog", { name: "Ajustes de Entreno" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("at 320 px Hoy's «Entreno» and /health don't scroll sideways @responsive", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const habitId = await insertHabit({ name: "Gimnasio" });
  await insertRoutine("Una rutina con un nombre largo para una pantalla angosta", [
    SQUAT.seedKey,
    BENCH.seedKey,
  ]);
  await linkHabit(habitId);
  await page.setViewportSize({ width: 320, height: 640 });
  await openToday(page);
  await expect(training(page).getByRole("button", { name: /^Empezar / })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await openHealth(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("Hoy's «Entreno»: the screenshot @responsive", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const habitId = await insertHabit({ name: "Gimnasio" });
  await insertRoutine("Rutina A", [SQUAT.seedKey, BENCH.seedKey]);
  await linkHabit(habitId);
  await openToday(page);
  await setTheme(page, "dark");
  await expect(training(page).getByRole("button", { name: "Empezar Rutina A" })).toBeVisible();
  await afterSaveSettled(page);
  await expectScreenshot(training(page), "today-training.png", { stylePath: SCREENSHOT_CSS });
});
