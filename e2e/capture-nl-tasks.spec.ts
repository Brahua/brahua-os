import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { isDesktop, limaDay } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import {
  captureSheet,
  captureStatus,
  captureTitle,
  openReady,
  readTask,
  readTaskByTitle,
  uniqueTitle,
} from "./support/tasks";
import { tasksTest as test } from "./support/today-tasks";

// polish → capture-nl-dates: the Tarea capture reads "pilas mañana" or "dentista vie 10am", shows
// what it understood under the field (a touch cancels it) and saves the title without the words.
// Every task here is due on a day AFTER today (tomorrow, or in two days), never today, so none of
// them shows on "/" (no `@today-tasks`): the weekday of "in two days" is computed, not fixed.

const THEMES = ["dark", "light"] as const;
// "mar" is not read as a weekday (it is also "sea"): "martes" in full.
const WEEKDAY_TEXT = ["dom", "lun", "martes", "mié", "jue", "vie", "sáb"];

/** The weekday word of the day `days` from Lima's today, as typed in the capture. */
function weekdayText(days: number) {
  return WEEKDAY_TEXT[new Date(`${limaDay(days)}T00:00:00Z`).getUTCDay()]!;
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

const openCapture = async (page: Page) => {
  await page.getByRole("button", { name: "Capturar" }).filter({ visible: true }).click();
  await expect(captureTitle(page)).toBeFocused();
};
const preview = (page: Page) => captureSheet(page).locator("[data-nl-preview]");

test("phone: 'pilas mañana' + Enter saves 'pilas' due tomorrow, in 3 interactions and under 10 s", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "The orange key of the bottom bar");
  const base = uniqueTitle("pilas", testInfo);
  await openReady(page, "/projects");

  const started = Date.now();
  await page.locator(".bo-bottomnav--fixed").getByRole("button", { name: "Capturar" }).click(); // 1
  await expect(captureTitle(page)).toBeFocused();
  await page.keyboard.type(`${base} mañana`); // 2
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press("Enter"); // 3
  await expect(captureStatus(page)).toHaveText("Tarea agregada a la bandeja.");
  expect(Date.now() - started).toBeLessThan(10_000);

  // The reading was cleared with the field, ready for the next one.
  await expect(captureTitle(page)).toHaveValue("");
  await expect(preview(page)).toHaveCount(0);
  const row = await readTaskByTitle(base);
  expect(row).toBeDefined();
  expect((await readTask(row!.id)).dueDate).toBe(limaDay(1));
  expect((await readTask(row!.id)).dueTime).toBeNull();
});

test("'dentista <weekday> 10am' saves the day and the hour; the title has neither", async ({
  page,
}, testInfo) => {
  const base = uniqueTitle("dentista", testInfo);
  // Two days ahead: never today (a weekday that is today waits a week) and never tomorrow.
  const word = weekdayText(2);
  await openReady(page, "/projects");
  await openCapture(page);
  await page.keyboard.type(`${base} ${word} 10am`);
  await expect(preview(page)).toContainText("10:00");
  await expect(preview(page)).toContainText("Vence el");
  await page.keyboard.press("Enter");
  await expect(captureStatus(page)).toHaveText("Tarea agregada a la bandeja.");

  const row = await readTaskByTitle(base);
  expect(row).toBeDefined();
  const saved = await readTask(row!.id);
  expect(saved.dueDate).toBe(limaDay(2));
  expect(saved.dueTime).toBe("10:00:00");
});

test("a touch on the preview cancels it: the text is saved as typed, with no date", async ({
  page,
}, testInfo) => {
  const base = uniqueTitle("llamar", testInfo);
  await openReady(page, "/projects");
  await openCapture(page);
  await page.keyboard.type(`${base} mañana`);
  await expect(preview(page)).toBeVisible();
  await preview(page).click();
  await expect(preview(page)).toHaveCount(0);
  // Focus is back in the field and the text is untouched.
  await expect(captureTitle(page)).toBeFocused();
  await expect(captureTitle(page)).toHaveValue(`${base} mañana`);
  await page.keyboard.press("Enter");
  await expect(captureStatus(page)).toHaveText("Tarea agregada a la bandeja.");

  const row = await readTaskByTitle(`${base} mañana`);
  expect(row).toBeDefined();
  expect((await readTask(row!.id)).dueDate).toBeNull();
});

test("a title with no tokens shows no preview and is saved unchanged (positive control: 3 pilas)", async ({
  page,
}, testInfo) => {
  const base = uniqueTitle("comprar 3 pilas", testInfo);
  await openReady(page, "/projects");
  await openCapture(page);
  await page.keyboard.type(base);
  await expect(preview(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(captureStatus(page)).toHaveText("Tarea agregada a la bandeja.");
  const row = await readTaskByTitle(base);
  expect(row).toBeDefined();
  expect((await readTask(row!.id)).dueDate).toBeNull();
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations with the preview showing, and the status is polite`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const base = uniqueTitle("revisar axe", testInfo);
    await openReady(page, "/projects");
    await setTheme(page, theme);
    await openCapture(page);
    await page.keyboard.type(`${base} mañana 10am`);
    await expect(preview(page)).toBeVisible();
    await expect(captureSheet(page).locator("[data-nl-status]")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    await expect(captureSheet(page).locator("[data-nl-status]")).toContainText("Vence el");
    expect(await axeViolations(page)).toEqual([]);
    // Nothing is saved: the sheet closes with the text unsent.
    await page.keyboard.press("Escape");
    await expect(captureSheet(page)).toBeHidden();
  });
}

test("at 320 px the preview doesn't scroll sideways and its key is at least 44 px", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const base = uniqueTitle("un título bastante largo para una pantalla angosta", testInfo);
  await page.setViewportSize({ width: 320, height: 640 });
  await openReady(page, "/projects");
  await page.locator(".bo-bottomnav--fixed").getByRole("button", { name: "Capturar" }).click();
  await expect(captureTitle(page)).toBeFocused();
  await page.keyboard.type(`${base} mañana 10am`);
  await expect(preview(page)).toBeVisible();
  const box = await preview(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(await captureSheet(page).evaluate((sheet) => sheet.scrollWidth <= sheet.clientWidth)).toBe(
    true,
  );
});
