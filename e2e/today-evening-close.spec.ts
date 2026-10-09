import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { E2E_EVENING_COOKIE } from "../src/modules/today/evening-close";
import { fontsLoaded } from "./support/fonts";
import { expect, insertHabit } from "./support/habits";
import { expectNoOverflow, isDesktop, limaDay, notices } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { readTask } from "./support/tasks";
import { boardTest as test, insertTodayTask } from "./support/today-tasks";

// polish → evening-close-ritual: the close of the day on "/" from 20:00 (Lima) when something is
// left. The hour is not the test's to fake (the server has its own clock), so an E2E build
// decides it with a cookie (`src/modules/today/evening-close-server.ts`): "on" is the close, no
// cookie is any hour of the day. Every test is a `boardTest`. No screenshot is taken of it (it is
// out of the layout in today-board-hidden.css, whatever the hour).

const THEMES = ["dark", "light"] as const;

async function evening(page: Page, baseURL: string | undefined) {
  await page.context().addCookies([{ name: E2E_EVENING_COOKIE, value: "on", url: baseURL }]);
}

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

const close = (page: Page) => page.locator("[data-evening-close]");
const question = (page: Page) => page.locator("[data-evening-question]");
const tomorrowKey = (page: Page) => close(page).getByRole("button", { name: "Mañana" });
const keepKey = (page: Page) => close(page).getByRole("button", { name: "Dejar aquí" });
const tasksList = (page: Page) => page.getByRole("list", { name: "Tareas de hoy" });

const unique = (prefix: string, testInfo: TestInfo) =>
  `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 6)}`;

/** A habit already done today (the close has something to say) and `n` tasks due today. */
async function setUp(n: number, testInfo: TestInfo) {
  await insertHabit({ name: unique("Meditar", testInfo), done: true });
  const made: { id: string; title: string }[] = [];
  for (let index = 0; index < n; index += 1) {
    const title = unique(`Tarea ${index + 1}`, testInfo);
    made.push({ id: await insertTodayTask({ title, due: 0, createdMinute: index }), title });
  }
  return made;
}

test("without the cookie the board is the board of any hour (positive control for the rest)", async ({
  page,
}, testInfo) => {
  await setUp(2, testInfo);
  await openToday(page);
  await expect(tasksList(page)).toBeVisible();
  await expect(close(page)).toHaveCount(0);
});

test("the close says what was achieved and asks once about the tasks left", async ({
  page,
  baseURL,
}, testInfo) => {
  await setUp(2, testInfo);
  await evening(page, baseURL);
  await openToday(page);
  await expect(close(page)).toBeVisible();
  await expect(close(page).getByRole("heading", { name: "Cierre del día" })).toBeVisible();
  await expect(close(page).locator("[data-evening-achieved] .sr-only")).toHaveText(
    "Hoy: 1 hábito.",
  );
  await expect(question(page)).toContainText("2");
  await expect(question(page)).toContainText(/tareas/);
  await expect(tomorrowKey(page)).toBeVisible();
  await expect(keepKey(page)).toBeVisible();
});

test("Mañana moves every task with one notice, and Deshacer brings them all back", async ({
  page,
  baseURL,
}, testInfo) => {
  const made = await setUp(2, testInfo);
  await evening(page, baseURL);
  await openToday(page);

  await tomorrowKey(page).click();
  await expect(tasksList(page)).toHaveCount(0);
  await expect(close(page).locator("[data-evening-question]")).toHaveCount(0);
  const notice = notices(page);
  await expect(notice).toContainText("2 tareas pasan a mañana.");
  await expect(notice.getByRole("button", { name: "Deshacer" })).toHaveCount(1);
  // Focus did not fall to <body>.
  await expect(page.locator("body")).not.toBeFocused();
  await afterSaveSettled(page);
  for (const { id } of made) {
    const task = await readTask(id);
    expect(task.dueDate).not.toBe(limaDay(0));
    expect(task.dueDate).toBe(limaDay(1));
  }

  await notice.getByRole("button", { name: "Deshacer" }).click();
  await expect(tasksList(page)).toBeVisible();
  await expect(question(page)).toBeVisible();
  await afterSaveSettled(page);
  for (const { id } of made) expect((await readTask(id)).dueDate).toBe(limaDay(0));
});

test("Dejar aquí moves nothing: the question goes away and the tasks stay in Hoy", async ({
  page,
  baseURL,
}, testInfo) => {
  const made = await setUp(2, testInfo);
  await evening(page, baseURL);
  await openToday(page);
  await keepKey(page).click();
  await expect(question(page)).toHaveCount(0);
  await expect(tasksList(page)).toBeVisible();
  await expect(close(page).getByRole("heading", { name: "Cierre del día" })).toBeFocused();
  await afterSaveSettled(page);
  for (const { id } of made) expect((await readTask(id)).dueDate).toBe(limaDay(0));
});

test("with only habits left there is no question, just what was achieved and 'X de N'", async ({
  page,
  baseURL,
}, testInfo) => {
  await insertHabit({ name: unique("Meditar", testInfo), done: true });
  await insertHabit({ name: unique("Leer", testInfo) });
  await evening(page, baseURL);
  await openToday(page);
  await expect(close(page)).toBeVisible();
  await expect(close(page).locator("[data-evening-habits]")).toHaveText("Hábitos: 1 de 2");
  await expect(question(page)).toHaveCount(0);
  await expect(tomorrowKey(page)).toHaveCount(0);
});

test("at 320 px it fits without scrolling sideways @responsive", async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await page.setViewportSize({ width: 320, height: 640 });
  await setUp(2, testInfo);
  await evening(page, baseURL);
  await openToday(page);
  await expect(close(page)).toBeVisible();
  await afterSaveSettled(page);
  await expectNoOverflow(page, close(page));
  // The keys are real touch targets.
  for (const key of [tomorrowKey(page), keepKey(page)]) {
    const box = (await key.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations with the close`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setUp(2, testInfo);
    await evening(page, baseURL);
    await openToday(page);
    await setTheme(page, theme);
    await expect(close(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
}
