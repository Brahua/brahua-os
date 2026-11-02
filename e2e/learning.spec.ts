import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import {
  expect,
  insertProjectTasks,
  insertTodayProject,
  insertTrack,
  openLearning,
  openToday,
  readSessions,
  readTrack,
  test,
} from "./support/learning";
import { isDesktop, notices, openProject, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// L3 of `learning`: the module's ONE E2E spec (CI budget). The way the owner uses it: a track
// created on /learning by pasting its syllabus and linking it to a project; on Hoy, its «Sigue con»
// card: a step marked «Hecho», «Estudiar» (the timer survives a reload) and «Detener» (the week
// moves); the project's progress counts the track as one unit with its share (1 of 2 tasks + the
// track at 50 % = 50 %, «1 de 3»). Axe in both themes on Hoy and /learning; 320 px without
// sideways scroll; one screenshot (the «Estudio» section). Every test is a board test that starts
// and ends with no tracks (e2e/support/learning.ts).

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

const study = (page: Page) => page.getByRole("region", { name: "Estudio" });

test("a track with its syllabus and project: «Hecho», the timer from Hoy and the project's progress @responsive", async ({
  page,
}, testInfo) => {
  const projectName = `Ruta AWS ${testInfo.project.name}`;
  const projectId = await insertTodayProject(projectName, "hobbies");
  await insertProjectTasks(projectId);

  // /learning: «Crear mi primer frente», the syllabus pasted, 3 h a week and the project.
  await openLearning(page);
  await page.getByRole("button", { name: "Crear mi primer frente" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo frente" });
  await sheet.getByRole("textbox", { name: "Nombre" }).fill("AWS SAA");
  await sheet.getByLabel("Qué es").selectOption("certification");
  await sheet
    .getByRole("textbox", { name: "Temario (opcional)" })
    .fill("Clase 1: Introducción\n\nClase 2: IAM policies\n");
  await expect(sheet.getByText("2 pasos.")).toBeVisible();
  await sheet.getByRole("button", { name: "Meta y fecha" }).click();
  await sheet.getByRole("textbox", { name: "Horas" }).fill("3");
  await sheet.getByRole("button", { name: "Proyecto y enlace" }).click();
  await sheet.getByLabel("Proyecto", { exact: true }).selectOption({ label: projectName });
  await untilSaved(page, () => sheet.getByRole("button", { name: "Crear frente" }).click());
  await expect(sheet).toBeHidden();
  await expect(notices(page).getByText("«AWS SAA» está en curso.")).toBeVisible();
  expect(await readTrack("AWS SAA")).toMatchObject({
    status: "active",
    kind: "certification",
    projectId,
    weeklyTargetMinutes: 180,
  });

  // Hoy: its «Sigue con» card.
  await openToday(page);
  const card = study(page).getByRole("listitem");
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("link", { name: "AWS SAA" })).toBeVisible();
  await expect(card.getByText("Clase 1: Introducción")).toBeVisible();
  await expect(card.getByText("0 de 2")).toBeVisible();
  await expect(card.getByText("0 min de 3 h esta semana · Te faltan 3 h")).toBeVisible();

  // «Hecho»: the next step and the bar move at once; focus stays on the key.
  await untilSaved(page, () =>
    card.getByRole("button", { name: "Marcar «Clase 1: Introducción» como hecho" }).click(),
  );
  await expect(card.getByText("Clase 2: IAM policies")).toBeVisible();
  await expect(card.getByText("1 de 2")).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Marcar «Clase 2: IAM policies» como hecho" }),
  ).toBeFocused();
  await expect(notices(page).getByText("«Clase 1: Introducción» está hecho.")).toBeVisible();

  // «Estudiar»: one key that turns into «Detener»; the timer survives a reload.
  const trackId = (await readTrack("AWS SAA")).id;
  await untilSaved(page, () =>
    card.getByRole("button", { name: "Estudiar AWS SAA: iniciar el cronómetro" }).click(),
  );
  await expect(notices(page).getByText("Estudiando «AWS SAA».")).toBeVisible();
  await expect.poll(async () => (await readSessions(trackId)).length).toBe(1);
  await openToday(page);
  const stop = study(page).getByRole("button", { name: "Detener el cronómetro de AWS SAA" });
  await expect(stop).toBeVisible();
  await expect(study(page).locator("[data-study-elapsed]")).toHaveText(/\d:\d\d/);

  // «Detener»: under a minute saves 1 min, and the week line moves.
  await untilSaved(page, () => stop.click());
  await expect(notices(page).getByText("Guardaste 1 min en «AWS SAA».")).toBeVisible();
  await expect(study(page).getByText("1 min de 3 h esta semana · Te faltan 2 h 59")).toBeVisible();
  const [session] = await readSessions(trackId);
  expect(session).toMatchObject({ source: "timer", minutes: 1 });
  expect(session.endedAt).not.toBeNull();

  // The project: 1 of 2 tasks plus the track at 50 % is 1.5 of 3 units → 50 %, «1 de 3».
  await openProject(page, projectId);
  const progress = page.locator("[data-project-progress] [data-progress]");
  await expect(progress).toHaveAttribute("data-progress", "1/3");
  // The label names both kinds of unit, never only «tareas» (L4).
  await expect(progress.getByRole("meter")).toHaveAccessibleName(
    /^Avance: 50\s?%, 1 de 3 tareas y frentes$/,
  );
  await expect(progress).toContainText("1 de 3 · tareas y frentes");
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (Hoy with «Estudio», /learning)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertTrack({
      title: "AWS Solutions Architect Associate",
      kind: "certification",
      steps: ["Clase 1", "Clase 2", "Clase 3: IAM policies", "Clase 4"],
      done: 2,
      weeklyTargetMinutes: 180,
    });
    await insertTrack({ title: "Inglés", kind: "practice" });
    await insertTrack({ title: "Docker", status: "waiting", steps: ["Capítulo 1"] });

    await openToday(page);
    await setTheme(page, theme);
    await expect(study(page).getByRole("listitem")).toHaveCount(2);
    expect(await axeViolations(page)).toEqual([]);

    // The timer running on a card.
    await untilSaved(page, () =>
      study(page).getByRole("button", { name: "Estudiar Inglés: iniciar el cronómetro" }).click(),
    );
    await expect(
      study(page).getByRole("button", { name: "Detener el cronómetro de Inglés" }),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await openLearning(page);
    await expect(page.locator('[data-tracks-section="active"]')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("at 320 px Hoy's «Estudio» and /learning don't scroll sideways @responsive", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await insertTrack({
    title: "Un frente de estudio con un nombre bastante largo para una pantalla angosta",
    kind: "certification",
    steps: ["Un paso del temario con un nombre bastante largo para una pantalla angosta", "Otro"],
    weeklyTargetMinutes: 195,
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await openToday(page);
  await expect(study(page).getByRole("listitem")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await openLearning(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("Hoy's «Estudio»: the screenshot @responsive", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await insertTrack({
    title: "AWS Solutions Architect Associate",
    kind: "certification",
    steps: ["Clase 12: VPC", "Clase 13: IAM policies", "Clase 14: S3", "Clase 15: EC2"],
    done: 1,
    weeklyTargetMinutes: 180,
  });
  await insertTrack({ title: "Inglés", kind: "practice" });
  await openToday(page);
  await setTheme(page, "dark");
  await afterSaveSettled(page);
  await expectScreenshot(study(page), "today-study.png", { stylePath: SCREENSHOT_CSS });
});
