import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import {
  currentYear,
  expect,
  goalRow,
  insertGoal,
  openGoals,
  readGoalByTitle,
  test,
} from "./support/goals";
import { isDesktop, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// G1 of `goals`: the one E2E spec of the module (CI budget): create a manual goal in under 20 s,
// "+1" with "Deshacer", the goal that reaches its target, axe in both themes (the list, "Anteriores",
// the form with errors, a goal's page), 320 px without sideways scroll and one screenshot of the
// list. Every test holds the goals lock and starts from an empty list (e2e/support/goals.ts).

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

test("empty: an explanation and a key to create the first goal", async ({ page }) => {
  await openGoals(page);
  await expect(
    page.getByRole("heading", { level: 2, name: "Todavía no tienes metas" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear mi primera meta" })).toBeVisible();
});

test("create a manual goal in under 20 s, then +1 and Deshacer @responsive", async ({
  page,
}, testInfo) => {
  const title = `Leer 12 libros ${testInfo.project.name}`;
  await openGoals(page);
  const started = Date.now();
  await page.getByRole("button", { name: "Crear mi primera meta" }).click();
  const sheet = page.getByRole("dialog", { name: "Nueva meta" });
  const field = sheet.getByRole("textbox", { name: "Título" });
  await expect(field).toBeFocused();
  await field.fill(title);
  await sheet.getByRole("textbox", { name: "Meta" }).fill("12");
  await sheet.getByRole("textbox", { name: "Unidad" }).fill("libros");
  await untilSaved(page, () => sheet.getByRole("button", { name: "Crear meta" }).click());
  await expect(sheet).toBeHidden();
  expect(Date.now() - started).toBeLessThan(20_000);
  // The new goal is in the year's section, and its link has focus (never <body>).
  await expect(page.getByRole("link", { name: title })).toBeFocused();
  await expect(goalRow(page, title).getByText("0 de 12 libros", { exact: true })).toBeVisible();
  expect(await readGoalByTitle(title)).toMatchObject({
    status: "active",
    target: 12,
    unit: "libros",
    sum: 0,
  });

  // One tap: the count moves at once, the notice says it and offers Deshacer.
  await untilSaved(page, () => page.getByRole("button", { name: `+1 en «${title}»` }).click());
  await expect(goalRow(page, title).getByText("1 de 12 libros", { exact: true })).toBeVisible();
  await expect(goalRow(page, title).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  await expect(notices(page).getByText(`+1 en «${title}»: 1 de 12 libros.`)).toBeVisible();
  await expect.poll(async () => (await readGoalByTitle(title))?.sum).toBe(1);

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(goalRow(page, title).getByText("0 de 12 libros", { exact: true })).toBeVisible();
  // The exact entry was undone (soft deleted), not a new negative one.
  await expect
    .poll(async () => readGoalByTitle(title))
    .toMatchObject({ sum: 0, live: 0, undone: 1 });
  await page.reload();
  await expect(goalRow(page, title).getByText("0 de 12 libros", { exact: true })).toBeVisible();
});

test("the tap that reaches the target achieves the goal; Deshacer reopens it", async ({ page }) => {
  const title = "Una más";
  await insertGoal({ title, target: 3, sum: 2 });
  await openGoals(page);
  await untilSaved(page, () => page.getByRole("button", { name: `+1 en «${title}»` }).click());
  await expect(goalRow(page, title)).toHaveAttribute("data-goal-status", "achieved");
  await expect(goalRow(page, title).getByText("Lograda", { exact: true })).toBeVisible();
  await expect(notices(page).getByText("Meta lograda")).toBeVisible();
  await expect
    .poll(async () => readGoalByTitle(title))
    .toMatchObject({ status: "achieved", sum: 3 });

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(goalRow(page, title)).toHaveAttribute("data-goal-status", "active");
  await expect.poll(async () => readGoalByTitle(title)).toMatchObject({ status: "active", sum: 2 });
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (empty, the list, Anteriores, the form, a goal)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openGoals(page);
    await setTheme(page, theme);
    expect(await axeViolations(page)).toEqual([]);

    await insertGoal({ title: "Leer 12 libros", target: 12, sum: 5, area: "learning" });
    await insertGoal({
      title: "Correr 90 km",
      periodKind: "quarter",
      target: 90,
      unit: "km",
      sum: 20,
      area: "health",
    });
    await insertGoal({ title: "Terminada", target: 4, sum: 4, status: "achieved" });
    await insertGoal({
      title: "Inglés",
      year: currentYear() - 1,
      target: 10,
      unit: "lecciones",
      sum: 7,
    });
    await insertGoal({ title: "Pintar", status: "archived", sum: 2 });
    await page.reload();
    await expect(page.getByRole("link", { name: "Leer 12 libros" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // A tap, then the notice.
    await untilSaved(page, () =>
      page.getByRole("button", { name: "+1 en «Leer 12 libros»" }).click(),
    );
    await expect(notices(page).getByRole("button", { name: "Deshacer" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // "Anteriores": a past goal with its final value, no alarm.
    await page.getByRole("button", { name: /Anteriores/ }).click();
    await expect(goalRow(page, "Inglés").getByText("Terminó con 7 de 10 lecciones.")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    // The form with its errors.
    await page.getByRole("button", { name: "Nueva meta" }).click();
    const form = page.getByRole("dialog", { name: "Nueva meta" });
    await form.getByRole("button", { name: "Crear meta" }).click();
    await expect(form.getByText("Escribe el título de la meta.")).toBeVisible();
    await expect(form.getByRole("textbox", { name: "Título" })).toBeFocused();
    expect(await axeViolations(page)).toEqual([]);
    await form.getByRole("button", { name: "Cancelar" }).click();
    await expect(form).toBeHidden();

    // A goal's page.
    await page.getByRole("link", { name: "Leer 12 libros" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Leer 12 libros" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("at 320 px the list doesn't scroll sideways @responsive", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await insertGoal({
    title: "Una meta con un nombre bastante largo para una pantalla angosta",
    target: 100000,
    unit: "kilómetros",
    sum: 99999,
  });
  await insertGoal({ title: "Leer", sum: 5 });
  await page.setViewportSize({ width: 320, height: 640 });
  await openGoals(page);
  await expect(page.getByRole("link", { name: "Leer", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("the list: the screenshot @responsive", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Only rows whose text doesn't depend on today's date: achieved goals say "Meta lograda".
  await insertGoal({
    title: "Leer 12 libros",
    target: 12,
    sum: 12,
    status: "achieved",
    area: "learning",
  });
  await insertGoal({
    title: "Correr 90 km",
    target: 90,
    unit: "km",
    sum: 40,
    status: "achieved",
    area: "health",
  });
  await insertGoal({
    title: "Ahorrar para el viaje",
    target: 8,
    unit: "meses",
    sum: 8,
    status: "achieved",
    area: "travel",
  });
  await openGoals(page);
  await setTheme(page, "dark");
  await afterSaveSettled(page);
  await expectScreenshot(page.locator('[data-goals-section="year"] ul'), "goals-list.png", {
    stylePath: SCREENSHOT_CSS,
  });
});
