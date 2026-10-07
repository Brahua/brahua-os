import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { expect } from "./support/habits";
import { isDesktop } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";
import { openReady, readTask } from "./support/tasks";
import { boardTest as test, insertTodayTask } from "./support/today-tasks";

// polish → task-time: the optional hour of a task. On "/" (`today`'s "Tareas") the tasks WITH an hour
// go first, by hour, and show it; the detail saves and removes it. Every test is a `boardTest`
// (e2e/support/today-tasks.ts): it holds the habits and tasks locks and starts with no task due
// today or before on the board, so the order read here is the order of its own tasks.

const THEMES = ["dark", "light"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

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

const section = (page: Page) => page.getByRole("region", { name: "Tareas" });
const list = (page: Page) => page.getByRole("list", { name: "Tareas de hoy" });
const titles = (page: Page) => list(page).getByRole("link");
const timeField = (page: Page) => page.getByLabel("Hora", { exact: true });
const clearKey = (page: Page) => page.getByRole("button", { name: "Quitar hora" });

const unique = (prefix: string, testInfo: TestInfo) =>
  `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 6)}`;

test("on '/', tasks with an hour come first, by hour, and show it; the others keep their order after", async ({
  page,
}, testInfo) => {
  // The one without an hour is the oldest and the highest priority: without the hour it would be first.
  const plain = unique("Sin hora", testInfo);
  const late = unique("Tarde", testInfo);
  const early = unique("Temprano", testInfo);
  const overdue = unique("Atrasada", testInfo);
  await insertTodayTask({ title: plain, due: 0, priority: "high", createdMinute: 0 });
  await insertTodayTask({ title: late, due: 0, dueTime: "15:30", createdMinute: 1 });
  await insertTodayTask({ title: early, due: 0, dueTime: "08:05", createdMinute: 2 });
  // An overdue day still goes before today, hour or not.
  await insertTodayTask({ title: overdue, due: -2, createdMinute: 3 });

  await openToday(page);
  // The board shows three and folds the rest: the ones with an hour are among the three.
  await expect(titles(page)).toHaveText([overdue, early, late]);
  await section(page).getByRole("button", { name: "Ver 1 más" }).click();
  await expect(titles(page)).toHaveText([overdue, early, late, plain]);

  const rowOf = (title: string) =>
    list(page)
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: title }) });
  await expect(rowOf(early).locator("[data-task-time]")).toHaveText("08:05");
  await expect(rowOf(late).locator("[data-task-time]")).toHaveText("15:30");
  // Positive control: the ones without an hour show none.
  await expect(rowOf(plain).locator("[data-task-time]")).toHaveCount(0);
  await expect(rowOf(overdue).locator("[data-task-time]")).toHaveCount(0);
});

test("the detail saves the hour and removes it; the hour survives a reload", async ({
  page,
}, testInfo) => {
  const title = unique("Dentista", testInfo);
  const id = await insertTodayTask({ title, due: 0 });
  await openReady(page, `/tasks/${id}`);

  await expect(timeField(page)).toHaveValue("");
  await timeField(page).fill("14:30");
  await expect.poll(async () => (await readTask(id)).dueTime).toBe("14:30:00");
  await afterSaveSettled(page);
  await page.reload();
  await expect(timeField(page)).toHaveValue("14:30");

  await clearKey(page).click();
  await expect.poll(async () => (await readTask(id)).dueTime).toBeNull();
  await expect(timeField(page)).toHaveValue("");
  await expect(timeField(page)).toBeFocused();
  await afterSaveSettled(page);
  await page.reload();
  await expect(timeField(page)).toHaveValue("");
  expect((await readTask(id)).dueDate).not.toBeNull();
});

test("taking the day away hides the hour field and clears the hour", async ({ page }, testInfo) => {
  const title = unique("Reunión", testInfo);
  const id = await insertTodayTask({ title, due: 0, dueTime: "09:00" });
  await openReady(page, `/tasks/${id}`);
  await expect(timeField(page)).toHaveValue("09:00");

  await page.getByLabel("Fecha límite").fill("");
  await expect(timeField(page)).toHaveCount(0);
  await expect.poll(async () => (await readTask(id)).dueDate).toBeNull();
  expect((await readTask(id)).dueTime).toBeNull();
  await afterSaveSettled(page);
  await page.reload();
  await expect(timeField(page)).toHaveCount(0);
});

test("at 320 px the hour field and its key fit and the page doesn't scroll sideways", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const id = await insertTodayTask({
    title: "Una tarea con un título realmente largo que tiene que partirse en varias líneas",
    due: 0,
    dueTime: "23:59",
    priority: "high",
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await openReady(page, `/tasks/${id}`);
  await expect(timeField(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const control of [timeField(page), clearKey(page)]) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await openToday(page);
  await expect(list(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

async function insertShowcase() {
  await insertTodayTask({
    title: "Llamar al dentista",
    due: 0,
    dueTime: "09:30",
    createdMinute: 0,
  });
  await insertTodayTask({
    title: "Entregar el informe",
    due: 0,
    dueTime: "16:00",
    createdMinute: 1,
  });
  await insertTodayTask({ title: "Comprar pilas", due: 0, createdMinute: 2 });
}

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (the rows with an hour, the detail's field)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertShowcase();
    await openToday(page);
    await setTheme(page, theme);
    await expect(section(page)).toBeVisible();
    await expect(page.locator("[data-task-time]")).toHaveCount(2);
    expect(await axeViolations(page)).toEqual([]);

    await titles(page).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Llamar al dentista" })).toBeVisible();
    await expect(timeField(page)).toHaveValue("09:30");
    await fontsLoaded(page);
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`${theme} theme: the rows with an hour (reference screenshot)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertShowcase();
    await openToday(page);
    await setTheme(page, theme);
    await expect(page.locator("[data-today-tasks-count]")).toHaveText("3 para hoy");
    await afterSaveSettled(page);
    await expectScreenshot(section(page), `task-time-today-${theme}.png`);
  });
}
