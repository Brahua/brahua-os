import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { formatDateKey } from "@/lib/time";
import { fontsLoaded } from "./support/fonts";
import { expect } from "./support/habits";
import { isDesktop, limaDay, notices, untilSaved } from "./support/projects";
import { readTasksByTitle } from "./support/recurrence";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";
import { openReady, readTask } from "./support/tasks";
import { insertViewTask, viewRow } from "./support/task-views";
import { boardTest as test, insertTodayTask, tasksTest } from "./support/today-tasks";

// polish → postpone-one-tap: "Mañana" and "Otro día…" on the rows of "/" (`today`'s "Tareas") and of
// the Hoy view of /tasks. The key is what runs here (the swipe is its touch shortcut, with one test
// at 390 px). Every board test is a `boardTest` (e2e/support/today-tasks.ts): it holds the habits
// and tasks locks and starts with no task due today or before on the board.

const THEMES = ["dark", "light"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

/** Opens "/" and waits until it is hydrated (taps and keys reach React) and laid out. */
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
const tomorrowKey = (page: Page, title: string) =>
  section(page).getByRole("button", { name: `Pasar a mañana: ${title}` });
const pickKey = (page: Page, title: string) =>
  section(page).getByRole("button", { name: `Elegir otro día para ${title}` });
const rowOf = (page: Page, id: string) => page.locator(`[data-task-row="${id}"]`);

const unique = (prefix: string, testInfo: TestInfo) =>
  `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 6)}`;

/** `n` tasks due today, in this order (same day and priority: by creation). */
async function insertInOrder(prefix: string, n: number, testInfo: TestInfo) {
  const made: { id: string; title: string }[] = [];
  for (let index = 0; index < n; index += 1) {
    const title = unique(`${prefix} ${index + 1}`, testInfo);
    made.push({ id: await insertTodayTask({ title, due: 0, createdMinute: index }), title });
  }
  return made;
}

/**
 * Starts timing a row's way out: from the next click (the tap) to the row's `<li>` leaving the
 * page. Resolves in milliseconds; start it before the click, await it after.
 */
function timeRowLeaving(page: Page, id: string) {
  return page.evaluate(
    (taskId) =>
      new Promise<number>((resolve) => {
        let tapped = 0;
        document.addEventListener("click", () => (tapped = performance.now()), {
          capture: true,
          once: true,
        });
        const row = document.querySelector(`[data-task-row="${taskId}"]`);
        const observer = new MutationObserver(() => {
          if (row && !row.isConnected) {
            observer.disconnect();
            resolve(performance.now() - tapped);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }),
    id,
  );
}

test("one tap on Mañana: the row leaves at once, the task moves to tomorrow, Deshacer brings it back", async ({
  page,
}, testInfo) => {
  const [first, second, third] = await insertInOrder("Mover", 3, testInfo);
  await openToday(page);
  await expect(titles(page)).toHaveText([first.title, second.title, third.title]);

  const left = timeRowLeaving(page, first.id);
  await untilSaved(page, () => tomorrowKey(page, first.title).click());
  // Well inside what a tap feels as instant (the fade is 90 ms; the bound leaves room for CI).
  expect(await left).toBeLessThan(300);
  await expect(titles(page)).toHaveText([second.title, third.title]);
  await expect(page.locator("[data-today-tasks-count]")).toHaveText("2 para hoy");
  // Focus goes to the same key of the next row, never <body>.
  await expect(tomorrowKey(page, second.title)).toBeFocused();
  await expect(notices(page).getByText(`«${first.title}» pasa a mañana.`)).toBeVisible();
  expect((await readTask(first.id)).dueDate).toBe(limaDay(1));

  // Moving a task is not completing it.
  expect((await readTask(first.id)).doneAt).toBeNull();

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(titles(page)).toHaveText([first.title, second.title, third.title]);
  await expect.poll(async () => (await readTask(first.id)).dueDate).toBe(limaDay(0));
  await expect(page.locator("[data-screen-announcer]")).toHaveText(
    `«${first.title}» volvió a su día.`,
  );
});

test("Deshacer of an overdue task restores the exact day it had", async ({ page }, testInfo) => {
  const title = unique("Atrasada", testInfo);
  const stays = unique("Se queda", testInfo);
  const id = await insertTodayTask({ title, due: -3 });
  await insertTodayTask({ title: stays, due: 0 });
  await openToday(page);
  await expect(titles(page)).toHaveText([title, stays]);

  await untilSaved(page, () => tomorrowKey(page, title).click());
  await expect(titles(page)).toHaveText([stays]);
  await expect.poll(async () => (await readTask(id)).dueDate).toBe(limaDay(1));

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(titles(page)).toHaveText([title, stays]);
  await expect.poll(async () => (await readTask(id)).dueDate).toBe(limaDay(-3));
});

test("a recurring task moves only this occurrence: no copy, the rule stays", async ({
  page,
}, testInfo) => {
  const title = unique("Regar plantas", testInfo);
  const id = await insertTodayTask({
    title,
    due: 0,
    recurrence: { kind: "every_days", interval: 3, weekdays: null, monthDay: null },
  });
  await insertTodayTask({ title: unique("Otra", testInfo), due: 0 });
  await openToday(page);

  await untilSaved(page, () => tomorrowKey(page, title).click());
  await expect(rowOf(page, id)).toHaveCount(0);
  const rows = await readTasksByTitle(title);
  // One task (no copy), tomorrow, still pending and still recurring.
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id, dueDate: limaDay(1), doneAt: null, spawnedFromId: null });
  expect(rows[0].recurrenceKind).toBe("every_days");
});

test("Otro día…: a sheet with a date; the row leaves and the notice says which day", async ({
  page,
}, testInfo) => {
  const [first, second] = await insertInOrder("Elegir", 2, testInfo);
  await openToday(page);

  await pickKey(page, first.title).click();
  const sheet = page.getByRole("dialog", { name: "Otro día" });
  await expect(sheet).toBeVisible();
  const day = sheet.getByLabel("Día");
  await expect(day).toHaveAttribute("min", limaDay(1));
  await day.fill(limaDay(6));
  await untilSaved(page, () => sheet.getByRole("button", { name: "Mover" }).click());
  await expect(sheet).toHaveCount(0);
  await expect(titles(page)).toHaveText([second.title]);
  await expect(
    notices(page).getByText(`«${first.title}» pasa al ${formatDateKey(limaDay(6), "short")}.`),
  ).toBeVisible();
  expect((await readTask(first.id)).dueDate).toBe(limaDay(6));
  // Focus is on the board (the next row's key), not lost on <body>.
  await expect(page.locator("body")).not.toBeFocused();

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(titles(page)).toHaveText([first.title, second.title]);
  await expect.poll(async () => (await readTask(first.id)).dueDate).toBe(limaDay(0));
});

test("the keys are 44 px or more and secondary; the checkbox stays the row's primary action", async ({
  page,
}, testInfo) => {
  const [first] = await insertInOrder("Tamaño", 1, testInfo);
  await openToday(page);
  for (const key of [tomorrowKey(page, first.title), pickKey(page, first.title)]) {
    const box = (await key.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    // Icon and text.
    await expect(key.locator("svg")).toHaveCount(1);
    await expect(key).not.toHaveClass(/bo-key--signal/);
  }
  await expect(tomorrowKey(page, first.title)).toHaveText("Mañana");
  await expect(pickKey(page, first.title)).toHaveText("Otro día…");
});

test("at 390 px a swipe to the left does what Mañana does; a short drag and a vertical one do not", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "The swipe is for touch widths (below 1024 px)");
  const [first, second] = await insertInOrder("Deslizar", 2, testInfo);
  await openToday(page);
  // Start on the empty part of the keys line (a mouse dragging a link starts the browser's own
  // drag, which a finger doesn't).
  const other = (await pickKey(page, first.title).boundingBox())!;
  const startX = other.x + other.width + 30;
  const y = other.y + other.height / 2;

  // Short: springs back, nothing is saved (positive control for the threshold).
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX - 30, y, { steps: 6 });
  await page.mouse.up();
  await expect(rowOf(page, first.id)).toBeVisible();
  expect((await readTask(first.id)).dueDate).toBe(limaDay(0));

  // Mostly vertical: it is the page's scroll, not a swipe.
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX - 50, y + 90, { steps: 8 });
  await page.mouse.up();
  await expect(rowOf(page, first.id)).toBeVisible();
  expect((await readTask(first.id)).dueDate).toBe(limaDay(0));

  // Far enough: Mañana.
  await untilSaved(page, async () => {
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX - 220, y, { steps: 10 });
    await page.mouse.up();
  });
  await expect(rowOf(page, first.id)).toHaveCount(0);
  await expect(titles(page)).toHaveText([second.title]);
  expect((await readTask(first.id)).dueDate).toBe(limaDay(1));
  await expect(notices(page).getByText(`«${first.title}» pasa a mañana.`)).toBeVisible();
});

test("at 320 px the rows with their keys don't scroll sideways", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await insertTodayTask({
    title: "Una tarea con un título realmente largo que tiene que partirse en varias líneas",
    due: -12,
    priority: "high",
  });
  await insertTodayTask({ title: "Llamar", due: 0, areaSlug: "relationships" });
  await page.setViewportSize({ width: 320, height: 640 });
  await openToday(page);
  await expect(list(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const item of await list(page).getByRole("listitem").all()) {
    const rowBox = (await item.boundingBox())!;
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(320);
  }
});

/** The section's tasks for axe and the screenshot: fixed titles (the board shows only these). */
async function insertShowcase() {
  await insertTodayTask({
    title: "Enviar la propuesta",
    due: -2,
    priority: "high",
    areaSlug: "work",
  });
  await insertTodayTask({ title: "Pagar el internet", due: 0, areaSlug: "home", createdMinute: 0 });
  await insertTodayTask({ title: "Llamar a mamá", due: 0, createdMinute: 1 });
}

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (the keys, the sheet, the notice)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertShowcase();
    await openToday(page);
    await setTheme(page, theme);
    await expect(section(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await pickKey(page, "Pagar el internet").click();
    const sheet = page.getByRole("dialog", { name: "Otro día" });
    await expect(sheet).toBeVisible();
    await animationsAndFonts(page);
    expect(await axeViolations(page)).toEqual([]);
    await sheet.getByRole("button", { name: "Cancelar" }).click();
    await expect(sheet).toHaveCount(0);

    await untilSaved(page, () => tomorrowKey(page, "Llamar a mamá").click());
    await expect(notices(page).getByRole("button", { name: "Deshacer" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`${theme} theme: the rows with their keys (reference screenshot)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertShowcase();
    await openToday(page);
    await setTheme(page, theme);
    await expect(page.locator("[data-today-tasks-count]")).toHaveText("3 para hoy");
    await afterSaveSettled(page);
    await expectScreenshot(section(page), `today-postpone-${theme}.png`);
  });
}

async function animationsAndFonts(page: Page) {
  await fontsLoaded(page);
  await afterSaveSettled(page);
}

// ── /tasks, the "Hoy" view ──

tasksTest(
  "Tareas > Hoy: Mañana takes it out of the view and Deshacer brings it back @today-tasks",
  async ({ page }, testInfo) => {
    const title = unique("Revisar", testInfo);
    const stays = unique("Se queda", testInfo);
    const id = await insertViewTask({ title, due: 0 });
    await insertViewTask({ title: stays, due: 0 });

    await openReady(page, "/tasks?vista=hoy");
    await expect(viewRow(page, title)).toBeVisible();
    await untilSaved(page, () =>
      viewRow(page, title)
        .getByRole("button", { name: `Pasar a mañana: ${title}` })
        .click(),
    );
    await expect(viewRow(page, title)).toHaveCount(0);
    await expect(viewRow(page, stays)).toBeVisible();
    await expect(notices(page).getByText(`«${title}» pasa a mañana.`)).toBeVisible();
    expect((await readTask(id)).dueDate).toBe(limaDay(1));

    await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
    await expect(viewRow(page, title)).toBeVisible();
    await expect.poll(async () => (await readTask(id)).dueDate).toBe(limaDay(0));
  },
);
