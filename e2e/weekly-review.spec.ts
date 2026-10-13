import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { weekLabel } from "@/modules/weekly-review/week";
import { fontsLoaded } from "./support/fonts";
import { expect } from "./support/habits";
import { isDesktop, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";
import {
  countReviews,
  insertObjective,
  insertReview,
  mondayTarget,
  nextWeek,
  readDueDates,
  readObjective,
  readReview,
  reviewedWeek,
  seedWeek,
  test,
} from "./support/weekly-review";

// W3 of `weekly-review`: the module's ONE E2E spec (CI budget). The ritual on a week that has gone by
// (e2e/support/weekly-review.ts): the figures of Logros, moving the open tasks to Monday with
// «Deshacer», the goals of step 3, the objective of the next week and the close, the closing screen,
// «Semanas anteriores» and closing again (idempotent); axe in both themes on every step and the
// closing screen; 320 px without sideways scroll; one screenshot (Logros). Every test is a
// `boardTest` that also holds the goals lock, and starts from the data it seeds itself.

const THEMES = ["dark", "light"] as const;
const SCREENSHOT_CSS = path.join(__dirname, "support/hide-app-nav.css");

/** The reviewed week's URL for a step (a week that has gone by: the numbers never move). */
const stepUrl = (step: 1 | 2 | 3 | 4, extra = "") =>
  `/review?${new URLSearchParams({ paso: String(step), semana: reviewedWeek() }).toString()}${extra}`;

/** Opens a step and waits until it is hydrated (keys and clicks reach React). */
async function openStep(page: Page, step: 1 | 2 | 3 | 4, extra = "") {
  await page.goto(stepUrl(step, extra));
  await expect(
    page.getByRole("heading", { level: 1, name: weekLabel(reviewedWeek()) }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

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

const objectiveField = (page: Page) =>
  page.getByRole("textbox", { name: /^Objetivo de la semana del / });
const noteField = (page: Page) => page.getByRole("textbox", { name: /^Nota de esta semana/ });
const closeKey = (page: Page, name = "Cerrar la semana") => page.getByRole("button", { name });
const history = (page: Page) => page.getByRole("region", { name: "Semanas anteriores" });

test("the whole ritual: Logros, Pendientes with Deshacer, Metas, Próxima semana, the close and the record @responsive", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { openIds, openDays } = await seedWeek({ goal: { title: "Leer 12 libros", sum: 5 } });
  const target = mondayTarget();
  // Positive control: the tasks start where the seed put them.
  expect(await readDueDates(openIds)).toEqual({
    [openIds[0]]: openDays[0],
    [openIds[1]]: openDays[1],
  });

  // 1 · Logros: the week's figures, no comparison; nothing is closed yet.
  await openStep(page, 1);
  await expect(page.getByText("Días completos esta semana: 4")).toBeVisible();
  await expect(page.locator('[data-figure="habits"]')).toContainText("4 de 7");
  await expect(page.locator('[data-figure="tasks"]')).toContainText("2");
  await expect(page.getByText("Correr · 4 de 7")).toBeVisible();
  await expect(
    history(page).getByText("Cuando cierres tu primera semana, aparecerá aquí."),
  ).toBeVisible();

  // 2 · Pendientes: the batch moves both to Monday, Deshacer puts each one back.
  await page.getByRole("link", { name: "Seguir" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /Pendientes/ })).toBeVisible();
  await expect(page.getByText("Quedaron abiertas 2 tareas.")).toBeVisible();
  await untilSaved(page, () => page.getByRole("button", { name: "Mover las 2 al lunes" }).click());
  await expect(page.getByText("Nada abierto. Buen cierre.")).toBeVisible();
  await expect(notices(page).getByText("Se movieron 2 tareas.")).toBeVisible();
  await expect
    .poll(() => readDueDates(openIds))
    .toEqual({ [openIds[0]]: target, [openIds[1]]: target });
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(page.getByText("Quedaron abiertas 2 tareas.")).toBeVisible();
  await expect
    .poll(() => readDueDates(openIds))
    .toEqual({ [openIds[0]]: openDays[0], [openIds[1]]: openDays[1] });

  // 3 · Metas y proyectos: read-only, with its goal and its pace, linked.
  await page.getByRole("link", { name: "Seguir" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /Metas y proyectos/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Leer 12 libros" })).toBeVisible();
  await expect(page.getByText("5 de 12 libros", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /Leer 12 libros/ })).toBeVisible();

  // 4 · Próxima semana: there is no «Seguir»; the objective and the note, then the close.
  await page.getByRole("link", { name: "Seguir" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /Próxima semana/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Seguir" })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await objectiveField(page).fill("Terminar la spec de la revisión");
  await noteField(page).fill("Aprendí que cerrar la semana me da calma");
  await untilSaved(page, () => closeKey(page).click());

  // The closing screen: what was achieved, «Volver a Hoy», the week in the record.
  await expect(page.getByRole("heading", { level: 2, name: "Semana cerrada" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.getByText("Días completos esta semana: 4")).toBeVisible();
  await expect(page.getByText("Terminar la spec de la revisión")).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver a Hoy" })).toHaveAttribute("href", "/");
  const entry = history(page).locator(`[data-history-week="${reviewedWeek()}"]`);
  await expect(entry).toContainText("Días completos: 4");
  await expect(entry).toContainText("4 de 7 hábitos");
  await expect(entry).toContainText("Aprendí que cerrar la semana me da calma");
  // The same objective /goals shows, written for the NEXT week; one review row.
  expect(await readObjective(nextWeek())).toBe("Terminar la spec de la revisión");
  const closed = await readReview(reviewedWeek());
  expect(closed?.note).toBe("Aprendí que cerrar la semana me da calma");
  expect(await countReviews()).toBe(1);

  // Back on step 4: «Esta semana ya está cerrada», the note is editable; closing is idempotent.
  await openStep(page, 4);
  await expect(page.getByText("Esta semana ya está cerrada")).toBeVisible();
  await expect(noteField(page)).toHaveValue("Aprendí que cerrar la semana me da calma");
  await expect(objectiveField(page)).toHaveValue("Terminar la spec de la revisión");
  await noteField(page).fill("Una nota mejor");
  await objectiveField(page).fill("");
  await untilSaved(page, () => closeKey(page, "Guardar cambios").click());
  await expect(page.getByRole("heading", { level: 2, name: "Semana cerrada" })).toBeVisible();
  await expect(history(page).locator(`[data-history-week="${reviewedWeek()}"]`)).toContainText(
    "Una nota mejor",
  );
  const again = await readReview(reviewedWeek());
  expect(again?.note).toBe("Una nota mejor");
  expect(again?.completedAt.getTime()).toBe(closed?.completedAt.getTime());
  expect(await countReviews()).toBe(1);
  // An empty objective never clears the one that was set.
  expect(await readObjective(nextWeek())).toBe("Terminar la spec de la revisión");
});

test("a failed close keeps what was typed and says why", async ({ page }) => {
  await seedWeek();
  await insertObjective(nextWeek(), "El de /goals");
  await openStep(page, 4);
  await expect(objectiveField(page)).toHaveValue("El de /goals");
  await noteField(page).fill("n".repeat(281));
  await closeKey(page).click();
  await expect(page.getByText("Usa 280 caracteres como máximo.")).toBeVisible();
  await expect(noteField(page)).toBeFocused();
  await expect(noteField(page)).toHaveValue("n".repeat(281));
  expect(await countReviews()).toBe(0);
  // Positive control: with a valid note the same key closes.
  await noteField(page).fill("Una nota corta");
  await untilSaved(page, () => closeKey(page).click());
  await expect(page.getByRole("heading", { level: 2, name: "Semana cerrada" })).toBeVisible();
  expect(await countReviews()).toBe(1);
  expect(await readObjective(nextWeek())).toBe("El de /goals");
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (the four steps, the form with its error, the closing screen)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedWeek({ goal: { title: "Leer 12 libros", sum: 5 } });
    await openStep(page, 1);
    await setTheme(page, theme);
    expect(await axeViolations(page)).toEqual([]);
    for (const step of [2, 3, 4] as const) {
      await openStep(page, step);
      expect(await axeViolations(page)).toEqual([]);
    }
    // The form with its error.
    await noteField(page).fill("n".repeat(281));
    await closeKey(page).click();
    await expect(page.getByText("Usa 280 caracteres como máximo.")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    // The closing screen and the record, and step 1 with a week in «Semanas anteriores».
    await insertReview(reviewedWeek(), "Una nota");
    await openStep(page, 4, "&cerrada=1");
    await expect(page.getByRole("heading", { level: 2, name: "Semana cerrada" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await openStep(page, 1);
    await expect(history(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("at 320 px no step scrolls sideways @responsive", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await seedWeek({
    goal: { title: "Una meta con un nombre bastante largo para una pantalla angosta", sum: 5 },
  });
  await insertReview(
    reviewedWeek(),
    "Una nota con palabras largas pero que caben en una pantalla de 320 px",
  );
  await page.setViewportSize({ width: 320, height: 640 });
  for (const step of [1, 2, 3, 4] as const) {
    await openStep(page, step);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  }
  await openStep(page, 4, "&cerrada=1");
  await expect(page.getByRole("heading", { level: 2, name: "Semana cerrada" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("Logros: the screenshot @responsive", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Only text that doesn't depend on today's date: the figures and the names of what was done.
  await seedWeek();
  await openStep(page, 1);
  await setTheme(page, "dark");
  await expect(page.getByText("Días completos esta semana: 4")).toBeVisible();
  await afterSaveSettled(page);
  await expectScreenshot(page.locator('[data-review-step="logros"]'), "review-logros.png", {
    stylePath: SCREENSHOT_CSS,
  });
});
