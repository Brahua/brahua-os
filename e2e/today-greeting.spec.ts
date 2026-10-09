import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { dayPartFor, ownerDateKey } from "@/lib/time";
import { greetingPool, isMonday, type DayState } from "@/modules/today/greeting";
import { fontsLoaded } from "./support/fonts";
import { expect, insertHabit } from "./support/habits";
import { expectNoOverflow, isDesktop, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { boardTest as test } from "./support/today-tasks";

// greeting-variants (corte `polish`): the line under the greeting of "/", by part of the Lima day
// and the day's state. Every test is a `boardTest` (the board's data is only what the test makes).
// The text depends on the hour and the day, so the tests check it against the pool of the current
// part and state (the pure selection has its own table in tests/modules/today-greeting.test.ts),
// and no screenshot is taken of it (it is hidden in today-board-hidden.css).

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

/** Every text the line can have now for a state (function variants for 1 to 9 things). */
function possibleLines(state: DayState): string[] {
  const now = new Date();
  const pool = greetingPool(dayPartFor(now), state, {
    monday: isMonday(ownerDateKey(now)),
    count: 1,
  });
  return pool.flatMap((variant) =>
    typeof variant === "string"
      ? [variant]
      : Array.from({ length: 9 }, (_, index) => variant(index + 1)),
  );
}

const line = (page: Page) => page.locator("[data-greeting-line]");
const board = (page: Page) => page.locator("[data-today-board]");
const complete = (page: Page) => page.getByRole("region", { name: "Día completo" });
const pad = (page: Page, name: string) =>
  page.getByRole("list", { name: "Hábitos de hoy" }).getByRole("button", { name, exact: true });

const unique = (prefix: string, testInfo: TestInfo) =>
  `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 6)}`;

test("the line follows the state of the day, and never moves the board", async ({
  page,
}, testInfo) => {
  const first = unique("Meditar", testInfo);
  const second = unique("Leer", testInfo);
  await insertHabit({ name: first, sortOrder: 0 });
  await insertHabit({ name: second, sortOrder: 1 });
  await openToday(page);

  // Nothing done: a line of that state, below the greeting and the date.
  const text = (await line(page).textContent()) ?? "";
  expect(possibleLines("none")).toContain(text);
  const boardTop = (await board(page).boundingBox())!.y;

  // Something done: another pool, at once, and the board stays where it was.
  await untilSaved(page, () => pad(page, first).click());
  await expect(line(page)).not.toHaveText(text);
  expect(possibleLines("some")).toContain((await line(page).textContent()) ?? "");
  expect((await board(page).boundingBox())!.y).toBe(boardTop);

  // Everything done: Día completo says it, the line steps aside without moving the board.
  await untilSaved(page, () => pad(page, second).click());
  await expect(complete(page)).toBeVisible();
  await expect(line(page)).toHaveText("");
  expect((await board(page).boundingBox())!.y).toBe(boardTop);

  // The same load, fresh: stable for the whole day (the same line on every read).
  await openToday(page);
  await expect(line(page)).toHaveText("");
});

test("the same state gives the same line on every load of the day", async ({ page }, testInfo) => {
  await insertHabit({ name: unique("Meditar", testInfo), sortOrder: 0 });
  await openToday(page);
  const text = await line(page).textContent();
  expect(text).not.toBe("");
  await openToday(page);
  await expect(line(page)).toHaveText(text!);
});

// The empty day (no line) is covered by tests/app/today-greeting.test.tsx: in the E2E database "/"
// is never empty (the fixture projects are due today), as in e2e/today.spec.ts.

test("the line is static text: no live region on it (positive control: the board's announcer is)", async ({
  page,
}, testInfo) => {
  await insertHabit({ name: unique("Meditar", testInfo), sortOrder: 0 });
  await openToday(page);
  await expect(line(page)).not.toHaveText("");
  expect(await line(page).evaluate((element) => element.closest("[aria-live]") === null)).toBe(
    true,
  );
  expect(await line(page).getAttribute("aria-live")).toBeNull();
  await expect(page.locator("[data-screen-announcer]")).toHaveAttribute("aria-live", "polite");
});

test("at 320 px it fits without scrolling sideways @responsive", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await page.setViewportSize({ width: 320, height: 640 });
  await insertHabit({ name: unique("Meditar", testInfo), sortOrder: 0 });
  await openToday(page);
  await expect(line(page)).not.toHaveText("");
  await afterSaveSettled(page);
  await expectNoOverflow(page, line(page));
  await expectNoOverflow(page, page.getByRole("heading", { level: 1 }));
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations with the line`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertHabit({ name: unique("Meditar", testInfo), sortOrder: 0 });
    await insertHabit({ name: unique("Leer", testInfo), sortOrder: 1 });
    await openToday(page);
    await setTheme(page, theme);
    await expect(line(page)).not.toHaveText("");
    expect(await axeViolations(page)).toEqual([]);

    // With something done (another pool of lines).
    await untilSaved(page, () =>
      page.getByRole("list", { name: "Hábitos de hoy" }).getByRole("button").first().click(),
    );
    expect(possibleLines("some")).toContain((await line(page).textContent()) ?? "");
    expect(await axeViolations(page)).toEqual([]);
  });
}
