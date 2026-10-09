import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { formatDateKey } from "@/lib/time";
import { fontsLoaded } from "./support/fonts";
import { expect } from "./support/habits";
import { expectNoOverflow, isDesktop, limaDay, notices, untilSaved } from "./support/projects";
import { readTasksByTitle } from "./support/recurrence";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";
import { readTask } from "./support/tasks";
import { boardTest as test, insertTodayProject, insertTodayTask } from "./support/today-tasks";

// D2 of `today` (SPEC-today): "Tareas" on "/": the overdue and due-today tasks, 3 shown and the
// rest behind "Ver N más", completed with one tap (with tasks' recurrence) and "Deshacer". Every
// test is a `boardTest` (e2e/support/today-tasks.ts): it holds the habits and tasks locks and
// starts with no habits and no task due today or before on the board, so it sees only its own.

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
/** The rows' titles (a retrying assertion: `toHaveText([...])`). */
const titles = (page: Page) => list(page).getByRole("link");
const check = (page: Page, title: string) =>
  section(page).getByRole("checkbox", { name: `Hecha: ${title}` });
const count = (page: Page) => page.locator("[data-today-tasks-count]");
const empty = (page: Page) => page.getByRole("region", { name: "Nada programado para hoy" });

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

test("one tap (Space) completes it, the folded next one rises, and Deshacer brings it back", async ({
  page,
}, testInfo) => {
  const [first, second, third, fourth] = await insertInOrder("Ordenar", 4, testInfo);
  await openToday(page);

  await expect(empty(page)).toHaveCount(0);
  await expect(count(page)).toHaveText("4 para hoy");
  await expect(titles(page)).toHaveText([first.title, second.title, third.title]);
  await expect(section(page).getByRole("button", { name: "Ver 1 más" })).toBeVisible();

  // By keyboard: focus moves to the next row's checkbox when the row leaves.
  await check(page, first.title).focus();
  await untilSaved(page, () => page.keyboard.press("Space"));
  await expect(titles(page)).toHaveText([second.title, third.title, fourth.title]);
  await expect(section(page).getByRole("button", { name: /^Ver/ })).toHaveCount(0);
  await expect(count(page)).toHaveText("3 para hoy");
  await expect(check(page, second.title)).toBeFocused();
  await expect(notices(page).getByText(`«${first.title}» está hecha.`)).toBeVisible();
  await expect.poll(async () => (await readTask(first.id)).doneAt).not.toBeNull();

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(titles(page)).toHaveText([first.title, second.title, third.title]);
  await expect(section(page).getByRole("button", { name: "Ver 1 más" })).toBeVisible();
  await expect.poll(async () => (await readTask(first.id)).doneAt).toBeNull();

  // Completing the only one left on the board: the section leaves, focus on the greeting.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  for (const task of [first, second, third]) {
    await untilSaved(page, () => check(page, task.title).click());
  }
  await check(page, fourth.title).focus();
  await untilSaved(page, () => page.keyboard.press("Space"));
  await expect(section(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  // Still there once the server's read of "/" arrives (never <body>).
  await afterSaveSettled(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(section(page)).toHaveCount(0);
});

test("Ver N más shows the rest on the page; Ver menos folds it again", async ({
  page,
}, testInfo) => {
  const tasks = await insertInOrder("Plegar", 5, testInfo);
  await openToday(page);
  await expect(titles(page)).toHaveCount(3);

  const more = section(page).getByRole("button", { name: "Ver 2 más" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(titles(page)).toHaveText(tasks.map((task) => task.title));
  const less = section(page).getByRole("button", { name: "Ver menos" });
  await expect(less).toBeFocused();
  await expect(less).toHaveAttribute("aria-expanded", "true");
  await less.click();
  await expect(titles(page)).toHaveCount(3);

  // Not remembered: a new visit starts folded.
  await expect(section(page).getByRole("button", { name: "Ver 2 más" })).toBeVisible();
  await more.click();
  await openToday(page);
  await expect(section(page).getByRole("button", { name: "Ver 2 más" })).toBeVisible();
});

test("a recurring task: the notice says when the next one is due; Deshacer removes it", async ({
  page,
}, testInfo) => {
  const title = unique("Regar plantas", testInfo);
  await insertTodayTask({
    title,
    due: 0,
    recurrence: { kind: "every_days", interval: 3, weekdays: null, monthDay: null },
  });
  await openToday(page);

  await untilSaved(page, () => check(page, title).click());
  await expect(
    notices(page).getByText(
      `«${title}» está hecha. La siguiente vence el ${formatDateKey(limaDay(3))}.`,
    ),
  ).toBeVisible();
  const [original, next] = await readTasksByTitle(title);
  expect(original.doneAt).not.toBeNull();
  expect(next).toMatchObject({ dueDate: limaDay(3), doneAt: null, spawnedFromId: original.id });
  // The next one is due in 3 days: not on the board; the server's read of "/" has no tasks.
  await expect(section(page)).toHaveCount(0);
  await afterSaveSettled(page);

  // Deshacer with the reopen held back: the row is back at once (the section stayed mounted),
  // marked as saving, before the server answers.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  await notices(page).getByRole("button", { name: "Deshacer" }).click();
  await expect(check(page, title)).toBeVisible();
  await expect(check(page, title)).toHaveAttribute("aria-disabled", "true");
  await untilSaved(page, async () => release());
  await page.unroute("**/*");
  await expect(check(page, title)).not.toHaveAttribute("aria-disabled");
  await expect(page.locator("[data-screen-announcer]")).toHaveText(
    `«${title}» volvió a estar pendiente y se quitó la siguiente.`,
  );
  await expect(check(page, title)).toBeVisible();
  const after = await readTasksByTitle(title);
  expect(after[0].doneAt).toBeNull();
  expect(after[1].deletedAt).not.toBeNull();
});

test("a task completed in Tareas is gone from Hoy when going back by the navigation", async ({
  page,
}, testInfo) => {
  const title = unique("Pagar luz", testInfo);
  const stays = unique("Comprar pan", testInfo);
  await insertTodayTask({ title, due: -1 });
  await insertTodayTask({ title: stays, due: 0 });
  await openToday(page);
  await expect(check(page, title)).toBeVisible();

  // "Ver tareas" (client navigation) to the "Hoy" view of Tareas, and complete it there.
  await section(page).getByRole("link", { name: "Ver tareas" }).click();
  await expect(page).toHaveURL("/tasks?vista=hoy");
  await untilSaved(page, () => page.getByRole("checkbox", { name: `Hecha: ${title}` }).click());

  // Client navigation (no reload): the revalidated "/" must not show it any more.
  await page
    .getByRole("navigation", { name: "Principal" })
    .getByRole("link", { name: "Hoy" })
    .click();
  await expect(page).toHaveURL("/");
  // The other one is there (positive control); the completed one is not.
  await expect(check(page, stays)).toBeVisible();
  await expect(check(page, title)).toHaveCount(0);
  await expect(count(page)).toHaveText("1 para hoy");
});

test("at 320 px the tasks don't scroll sideways @responsive", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const project = await insertTodayProject(
    unique("Un proyecto con un nombre bastante largo para la fila", testInfo),
    "learning",
  );
  await insertTodayTask({
    title: "Una tarea con un título realmente largo que tiene que partirse en varias líneas",
    due: -12,
    priority: "high",
    projectId: project,
    isNextAction: true,
  });
  await insertTodayTask({ title: "Llamar", due: 0, areaSlug: "relationships" });
  await page.setViewportSize({ width: 320, height: 640 });
  await openToday(page);
  await expect(list(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const item of await list(page).getByRole("listitem").all()) {
    await expectNoOverflow(page, item);
  }
  // The checkbox's label is the 44 px touch target (principle 14).
  const target = (await list(page).locator("label").first().boundingBox())!;
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
});

/** The section's tasks for axe and the screenshot: fixed titles (the board shows only these). */
async function insertShowcase() {
  const project = await insertTodayProject("Lanzamiento web", "work");
  await insertTodayTask({
    title: "Enviar la propuesta",
    due: -2,
    priority: "high",
    projectId: project,
    isNextAction: true,
  });
  await insertTodayTask({ title: "Pagar el internet", due: 0, areaSlug: "home", createdMinute: 0 });
  await insertTodayTask({ title: "Llamar a mamá", due: 0, createdMinute: 1 });
  await insertTodayTask({
    title: "Leer un capítulo",
    due: 0,
    areaSlug: "learning",
    priority: "low",
  });
}

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (the section, folded and open, a notice)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertShowcase();
    await openToday(page);
    await setTheme(page, theme);
    await expect(section(page)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await section(page).getByRole("button", { name: "Ver 1 más" }).click();
    expect(await axeViolations(page)).toEqual([]);

    await untilSaved(page, () => check(page, "Llamar a mamá").click());
    await expect(notices(page).getByRole("button", { name: "Deshacer" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`${theme} theme: the Tareas section (reference screenshot) @responsive`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertShowcase();
    await openToday(page);
    await setTheme(page, theme);
    await expect(count(page)).toHaveText("4 para hoy");
    await afterSaveSettled(page);
    // Only the section: the header's greeting and date change with the hour.
    await expectScreenshot(section(page), `today-tasks-${theme}.png`);
  });
}
