import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { isDesktop } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { readTagId, readTaskTags, tagTask, uniqueTag } from "./support/task-tags";
import {
  captureSheet,
  captureStatus,
  captureTitle,
  insertTask,
  openReady,
  readTaskByTitle,
  taskRow,
  uniqueTitle,
} from "./support/tasks";

// T4 of `tasks`: tags while capturing and in the detail (an editable combobox with
// suggestions), the chips in a row, removing one, keyboard only, and axe. Tags are global and
// tests run in parallel: each test uses its own tag names and its own task.

const THEMES = ["dark", "light"] as const;

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

/** Opens a task's detail from the inbox: the side sheet on the desktop, its page on the phone. */
async function openDetail(page: Page, title: string, testInfo: TestInfo): Promise<Locator> {
  await openReady(page, "/tasks");
  await taskRow(page, title).getByRole("link", { name: title }).click();
  if (isDesktop(testInfo)) {
    const sheet = page.getByRole("dialog", { name: title });
    await expect(sheet).toBeVisible();
    return sheet;
  }
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return page.locator("main");
}

const chipsOf = (scope: Locator) =>
  scope.getByRole("list", { name: "Etiquetas elegidas" }).getByRole("listitem");

test("capture: tags under Más detalles (Enter and a comma) go with the task; the row shows them", async ({
  page,
}, testInfo) => {
  const title = uniqueTitle("comprar focos", testInfo);
  const first = uniqueTag("compras", testInfo);
  const second = uniqueTag("hogar", testInfo);
  await openReady(page, "/tasks");
  await page.getByRole("button", { name: "Capturar" }).filter({ visible: true }).click();
  await expect(captureTitle(page)).toBeFocused();
  await captureSheet(page).getByRole("button", { name: "Más detalles" }).click();
  const field = captureSheet(page).getByRole("combobox", { name: "Etiquetas" });
  // Uppercase and spaces are normalized; a comma adds as well as Enter.
  await field.fill("");
  await field.pressSequentially(`  ${first.toUpperCase()} `);
  await field.press("Enter");
  await field.pressSequentially(`${second},`);
  await expect(chipsOf(captureSheet(page))).toHaveText([first, second]);
  await captureTitle(page).fill(title);
  await captureTitle(page).press("Enter");
  await expect(captureStatus(page)).toHaveText("Tarea agregada a la bandeja.");
  // Ready for the next one: no tags left.
  await expect(chipsOf(captureSheet(page))).toHaveCount(0);

  const saved = await readTaskByTitle(title);
  expect(await readTaskTags(saved!.id)).toEqual([first, second].sort());
  await page.keyboard.press("Escape");
  await expect(captureSheet(page)).toBeHidden();
  const link = taskRow(page, title).getByRole("link", { name: title });
  await expect(link).toHaveAccessibleDescription(
    new RegExp(`Etiquetas: (${first}, ${second}|${second}, ${first})`),
  );
  await expect(taskRow(page, title).locator(".bo-task-tag")).toHaveCount(2);
});

test("detail, keyboard only: suggestions with ↓ and Enter, a new one, and removing one", async ({
  page,
}, testInfo) => {
  const title = uniqueTitle("ordenar garaje", testInfo);
  const other = uniqueTitle("otra tarea", testInfo);
  const known = uniqueTag("limpieza", testInfo);
  const created = uniqueTag("nueva", testInfo);
  const spare = uniqueTag("repuesto", testInfo);
  // An existing tag (on another task) to be suggested.
  await tagTask(await insertTask({ title: other }), [known, spare]);
  const id = await insertTask({ title });

  const scope = await openDetail(page, title, testInfo);
  const field = scope.getByRole("combobox", { name: "Agregar etiqueta" });
  await field.focus();
  // The whole name: other tests (and retries) have tags with the same prefix.
  await page.keyboard.type(known.slice(0, -1));
  await expect(field).toHaveAttribute("aria-expanded", "true");
  const option = scope.getByRole("option", { name: known });
  await expect(option).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(field).toHaveAttribute("aria-activedescendant", (await option.getAttribute("id"))!);
  await expect(option).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => readTaskTags(id)).toEqual([known]);

  await page.keyboard.type(created);
  await page.keyboard.press("Enter");
  await expect(chipsOf(scope)).toHaveText([known, created]);
  await expect.poll(() => readTaskTags(id)).toEqual([known, created].sort());

  // Esc closes the open list only (the sheet stays on the desktop).
  await page.keyboard.type(spare.slice(0, -1));
  await expect(field).toHaveAttribute("aria-expanded", "true");
  await expect(scope.getByRole("option", { name: spare })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(field).toHaveAttribute("aria-expanded", "false");
  await expect(field).toBeVisible();
  for (let index = 0; index < spare.length - 1; index++) await page.keyboard.press("Backspace");
  await expect(field).toHaveValue("");

  // Back to the last chip's key, and remove it with the keyboard.
  await page.keyboard.press("Shift+Tab");
  await expect(
    scope.getByRole("button", { name: `Quitar la etiqueta «${created}»` }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(field).toBeFocused();
  await expect(chipsOf(scope)).toHaveText([known]);
  await expect.poll(() => readTaskTags(id)).toEqual([known]);

  // After a reload it is still there.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await openDetail(page, title, testInfo);
  await expect(
    chipsOf(isDesktop(testInfo) ? page.getByRole("dialog", { name: title }) : page.locator("main")),
  ).toHaveText([known]);
});

test("detail: removing with a tap; an unused tag is no longer suggested", async ({
  page,
}, testInfo) => {
  const title = uniqueTitle("pagar luz", testInfo);
  const only = uniqueTag("solo", testInfo);
  const id = await insertTask({ title });
  await tagTask(id, [only]);

  const scope = await openDetail(page, title, testInfo);
  await expect(chipsOf(scope)).toHaveText([only]);
  await scope.getByRole("button", { name: `Quitar la etiqueta «${only}»` }).click();
  await expect(chipsOf(scope)).toHaveCount(0);
  await expect.poll(() => readTaskTags(id)).toEqual([]);

  // Opened again (fresh suggestions): the tag no task uses is not offered.
  await page.goto("/tasks");
  const again = await openDetail(page, title, testInfo);
  const field = again.getByRole("combobox", { name: "Agregar etiqueta" });
  await field.fill(only);
  await expect(field).toHaveAttribute("aria-expanded", "false");
  await expect(again.getByRole("option", { name: only })).toHaveCount(0);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (capture and detail with tags, list open)`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const title = uniqueTitle("revisar etiquetas", testInfo);
    const name = uniqueTag("axe", testInfo);
    const id = await insertTask({ title, due: 0 });
    await tagTask(id, [name]);
    await openReady(page, "/tasks");
    await setTheme(page, theme);
    // The row with its tag chips.
    await expect(taskRow(page, title).locator(".bo-task-tag")).toHaveText([name]);
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Capturar" }).filter({ visible: true }).click();
    await expect(captureTitle(page)).toBeFocused();
    await captureSheet(page).getByRole("button", { name: "Más detalles" }).click();
    const field = captureSheet(page).getByRole("combobox", { name: "Etiquetas" });
    await field.pressSequentially("uno");
    await field.press("Enter");
    // The suggestions open, one active.
    await field.pressSequentially(name.slice(0, 5));
    await field.press("ArrowDown");
    await expect(field).toHaveAttribute("aria-expanded", "true");
    await expect(field).toHaveAttribute("aria-activedescendant", /.+/);
    expect(await axeViolations(page)).toEqual([]);
    // An error on the field too.
    await field.fill("a".repeat(31));
    await field.press("Enter");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    expect(await axeViolations(page)).toEqual([]);
    await field.fill("");
    await captureSheet(page).getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(captureSheet(page)).toBeHidden();

    const scope = await openDetail(page, title, testInfo);
    await expect(chipsOf(scope)).toHaveText([name]);
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("at 320 px each chip's remove key has a 44 px touch area, and nothing scrolls sideways", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const title = uniqueTitle("tocar quitar", testInfo);
  const names = [uniqueTag("uno", testInfo), uniqueTag("una-etiqueta-larga", testInfo)];
  const id = await insertTask({ title });
  await tagTask(id, names);
  await page.setViewportSize({ width: 320, height: 640 });
  const scope = await openDetail(page, title, testInfo);
  for (const name of names) {
    const label = `Quitar la etiqueta «${name}»`;
    const key = scope.getByRole("button", { name: label });
    // elementFromPoint only sees the viewport.
    await key.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const box = (await key.boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // 21 px from the center each way is still the key (its ::before reaches 22 px).
    for (const [dx, dy] of [
      [-21, 0],
      [21, 0],
      [0, -21],
      [0, 21],
    ]) {
      const hit = await page.evaluate(
        (point) =>
          document
            .elementFromPoint(point.x, point.y)
            ?.closest("button")
            ?.getAttribute("aria-label") === point.label,
        { x: center.x + dx, y: center.y + dy, label },
      );
      expect(hit, `${name} at ${dx},${dy}`).toBe(true);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("Todas: filter by a tag (?etiqueta=<id>), then back to all", async ({ page }, testInfo) => {
  const tagged = uniqueTitle("con etiqueta", testInfo);
  const other = uniqueTitle("sin etiqueta", testInfo);
  const name = uniqueTag("filtro", testInfo);
  await tagTask(await insertTask({ title: tagged }), [name]);
  await insertTask({ title: other });
  const id = await readTagId(name);

  await openReady(page, "/tasks?vista=todas");
  const list = page.getByRole("list", { name: "Tareas pendientes" });
  await expect(list.getByRole("link", { name: other, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Filtrar por etiqueta: Todas" }).click();
  const sheet = page.getByRole("dialog", { name: "Filtrar por etiqueta" });
  await sheet.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(`/tasks?vista=todas&etiqueta=${id}`);
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: `Filtrar por etiqueta: ${name}` })).toBeFocused();
  await expect(list.getByRole("link", { name: tagged, exact: true })).toBeVisible();
  await expect(list.getByRole("link", { name: other, exact: true })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);

  // A reload keeps it; "Todas las etiquetas" clears it.
  await page.reload();
  await expect(list.getByRole("link", { name: other, exact: true })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await page.getByRole("button", { name: `Filtrar por etiqueta: ${name}` }).click();
  await sheet.getByRole("link", { name: "Todas las etiquetas" }).click();
  await expect(page).toHaveURL("/tasks?vista=todas");
  await expect(list.getByRole("link", { name: other, exact: true })).toBeVisible();
});
