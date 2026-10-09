import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { isDesktop, limaDay, notices, untilSaved } from "./support/projects";
import { insertRecurringTask, limaWeekday, readTasksByTitle } from "./support/recurrence";
import { afterSaveSettled } from "./support/saves";
import { tasksTest as test } from "./support/today-tasks";
import {
  captureSheet,
  captureStatus,
  captureTitle,
  openReady,
  taskRow,
  uniqueTitle,
} from "./support/tasks";

// T3 of `tasks`: recurring tasks. Each test works on its own task (a unique title); the inbox is
// shared by tests running in parallel, so rows are never counted across titles.

const THEMES = ["dark", "light"] as const;
const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

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

/** Opens a task's detail: the side sheet on the desktop, its page on the phone. */
async function openDetail(page: Page, title: string, desktop: boolean) {
  await taskRow(page, title).getByRole("link", { name: title }).click();
  if (desktop) {
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    return dialog;
  }
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return page.locator("main");
}

test("capture a recurring task; completing it brings the next one with its date; Deshacer removes it @today-tasks", async ({
  page,
}, testInfo) => {
  const title = uniqueTitle("regar las plantas", testInfo);
  await openReady(page, "/tasks");
  await page.getByRole("button", { name: "Capturar" }).filter({ visible: true }).click();
  await expect(captureTitle(page)).toBeFocused();
  await captureTitle(page).fill(title);
  await captureSheet(page).getByRole("button", { name: "Más detalles" }).click();
  await captureSheet(page)
    .getByRole("radio", { name: /Cada cierto tiempo/ })
    .check();
  const interval = captureSheet(page).getByRole("textbox", { name: "Cada" });
  await interval.fill("3");
  await expect(captureSheet(page).locator("[data-recurrence-summary]")).toContainText(
    "Cada 3 días desde que la completas",
  );
  await captureTitle(page).press("Enter");
  await expect(captureStatus(page)).toHaveText("Tarea agregada a la bandeja.");
  await page.keyboard.press("Escape");
  await expect(captureSheet(page)).toBeHidden();

  await page.reload();
  const row = taskRow(page, title);
  await expect(row.getByRole("link", { name: title })).toHaveAccessibleDescription(
    "Se repite: cada 3 días desde que la completas",
  );

  // Complete: the original leaves, the next one is there, due in 3 days.
  await untilSaved(page, () => row.getByRole("checkbox", { name: `Hecha: ${title}` }).click());
  await expect(
    notices(page).getByText(new RegExp(`«${title}» está hecha\\. La siguiente vence el`)),
  ).toBeVisible();
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("link", { name: title })).toHaveAccessibleDescription(
    "Vence en 3 días, Se repite: cada 3 días desde que la completas",
  );
  const [original, next] = await readTasksByTitle(title);
  expect(original.doneAt).not.toBeNull();
  expect(next).toMatchObject({
    dueDate: limaDay(3),
    doneAt: null,
    deletedAt: null,
    spawnedFromId: original.id,
    recurrenceKind: "every_days",
    recurrenceInterval: 3,
  });

  // Deshacer: the original is back and the untouched next one is gone.
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(page.locator("[data-tasks-announcer]")).toHaveText(
    `«${title}» volvió a estar pendiente y se quitó la siguiente.`,
  );
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("link", { name: title })).toHaveAccessibleDescription(
    "Se repite: cada 3 días desde que la completas",
  );
  const after = await readTasksByTitle(title);
  expect(after[0].doneAt).toBeNull();
  expect(after[1].deletedAt).not.toBeNull();
  await page.reload();
  await expect(taskRow(page, title)).toHaveCount(1);
});

test("the editor works by keyboard in the detail, and saves each choice; No se repite removes it", async ({
  page,
}, testInfo) => {
  const title = uniqueTitle("sacar la basura", testInfo);
  await insertRecurringTask(title, null);
  await openReady(page, "/tasks");
  const scope = await openDetail(page, title, isDesktop(testInfo));
  const modes = scope.getByRole("group", { name: "Se repite" });
  await modes.getByRole("radio", { name: "No se repite" }).focus();

  // Arrow keys move through the radio group, and each choice saves.
  await untilSaved(page, () => page.keyboard.press("ArrowDown"));
  await expect(modes.getByRole("radio", { name: /Cada cierto tiempo/ })).toBeChecked();
  await untilSaved(page, () => page.keyboard.press("ArrowDown"));
  await expect(modes.getByRole("radio", { name: "Ciertos días de la semana" })).toBeChecked();
  const today = limaWeekday();
  await expect
    .poll(async () => (await readTasksByTitle(title))[0].recurrenceWeekdays)
    .toEqual([today]);

  // Tab reaches the day keys; Space toggles one more.
  const other = today === 1 ? 2 : 1;
  const days = scope.getByRole("group", { name: "Días" });
  await page.keyboard.press("Tab");
  await expect(days.getByRole("button", { name: "Lunes" })).toBeFocused();
  if (other === 2) await page.keyboard.press("Tab");
  await expect(days.getByRole("button", { name: WEEKDAYS[other - 1] })).toBeFocused();
  await untilSaved(page, () => page.keyboard.press("Space"));
  await expect(days.getByRole("button", { name: WEEKDAYS[other - 1] })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(async () => (await readTasksByTitle(title))[0].recurrenceWeekdays)
    .toEqual([today, other].sort((a, b) => a - b));
  await expect(scope.locator("[data-recurrence-summary]")).toContainText(/^Los /);

  // Back up the radio group to "No se repite": the rule is removed.
  await modes.getByRole("radio", { name: "Ciertos días de la semana" }).focus();
  await untilSaved(page, () => page.keyboard.press("ArrowUp"));
  await untilSaved(page, () => page.keyboard.press("ArrowUp"));
  await expect(modes.getByRole("radio", { name: "No se repite" })).toBeChecked();
  await expect.poll(async () => (await readTasksByTitle(title))[0].recurrenceKind).toBeNull();
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (recurring row, detail editor, capture editor)`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const title = uniqueTitle("pagar el agua", testInfo);
    await insertRecurringTask(title, {
      kind: "weekdays",
      interval: null,
      weekdays: [1, 4],
      monthDay: null,
    });
    await openReady(page, "/tasks");
    await setTheme(page, theme);
    await expect(taskRow(page, title)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    const scope = await openDetail(page, title, isDesktop(testInfo));
    await expect(scope.getByRole("group", { name: "Días" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await page.goto("/tasks");
    await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
    await page.getByRole("button", { name: "Capturar" }).filter({ visible: true }).click();
    await expect(captureTitle(page)).toBeFocused();
    await captureSheet(page).getByRole("button", { name: "Más detalles" }).click();
    await captureSheet(page).getByRole("radio", { name: "Un día de cada mes" }).check();
    // With an error on the day of the month too.
    const day = captureSheet(page).getByRole("textbox", { name: "Día del mes" });
    await day.fill("40");
    await day.press("Tab");
    await expect(day).toHaveAttribute("aria-invalid", "true");
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("at 320 px the editor fits without scrolling sideways @responsive", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const title = uniqueTitle("regar", testInfo);
  await insertRecurringTask(title, {
    kind: "weekdays",
    interval: null,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    monthDay: null,
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await openReady(page, "/tasks");
  await openDetail(page, title, false);
  await expect(page.getByRole("group", { name: "Días" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
