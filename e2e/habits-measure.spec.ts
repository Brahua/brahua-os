import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import {
  expect,
  habitsCount,
  insertHabit,
  openHabits,
  pad,
  pads,
  readHabit,
  readHabitByName,
  test,
} from "./support/habits";
import { isDesktop, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// H3 of `habits`: quantities ("8 vasos", "varias veces al día"), "Ajustar el día" and habits to
// avoid (a relapse with one tap), with axe in both themes and the screenshots of "Hoy" with them.
// Every test holds the habits lock and starts from an empty "Hoy" (e2e/support/habits.ts).

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

const unique = (prefix: string, testInfo: TestInfo) =>
  `${prefix} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 6)}`;

/** The pad's status line ("3/8 VASOS"). */
const status = (page: Page, name: string) => pad(page, name).locator(".bo-key__sub");

test("8 vasos: each tap adds one until the goal; Deshacer takes one back", async ({
  page,
}, testInfo) => {
  const name = unique("Agua", testInfo);
  const id = await insertHabit({ name, quantity: { goal: 8, unit: "vasos", today: 6 } });
  await openHabits(page);
  await expect(status(page, name)).toHaveText("6/8 VASOS");
  await expect(habitsCount(page)).toHaveText("0 de 1 hoy");

  await untilSaved(page, () => pad(page, name).click());
  await expect(status(page, name)).toHaveText("7/8 VASOS");
  await expect(notices(page).getByText(`«${name}»: 7 de 8 vasos hoy.`)).toBeVisible();
  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(status(page, name)).toHaveText("6/8 VASOS");
  await expect.poll(async () => (await readHabit(id)).today).toBe(6);

  // Two quick taps both count. `untilSaved` may resolve on the first tap's response: the poll on
  // the database below (8) is what proves both were saved; keep it.
  await pad(page, name).click();
  await untilSaved(page, () => pad(page, name).click());
  await expect(status(page, name)).toHaveText("8/8 VASOS");
  await expect(notices(page).getByText("Meta cumplida")).toBeVisible();
  await expect(habitsCount(page)).toHaveText("1 de 1 hoy");
  await expect(pad(page, name)).toHaveClass(/is-on/);
  await expect.poll(async () => (await readHabit(id)).today).toBe(8);
  await page.reload();
  await expect(status(page, name)).toHaveText("8/8 VASOS");
});

test("varias veces al día: created with the shortcut, 1/2 then 2/2", async ({ page }, testInfo) => {
  const name = unique("Medicación", testInfo);
  await openHabits(page);
  await page.getByRole("button", { name: "Crear un hábito" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo hábito" });
  await sheet.getByRole("textbox", { name: "Nombre" }).fill(name);
  await sheet.getByRole("button", { name: "Varias veces al día" }).click();
  await expect(sheet.getByRole("textbox", { name: "Meta del día" })).toHaveValue("2");
  await expect(sheet.getByText("Cada día · 2 veces")).toBeVisible();
  await untilSaved(page, () => sheet.getByRole("button", { name: "Crear hábito" }).click());
  await expect(sheet).toBeHidden();
  await expect(pad(page, name)).toBeFocused();
  await expect(status(page, name)).toHaveText("0/2 VECES");

  await untilSaved(page, () => pad(page, name).click());
  await expect(status(page, name)).toHaveText("1/2 VECES");
  await untilSaved(page, () => pad(page, name).click());
  await expect(status(page, name)).toHaveText("2/2 VECES");
  await expect(habitsCount(page)).toHaveText("1 de 1 hoy");
  const created = await readHabitByName(name);
  expect(created).toBeDefined();
  await expect.poll(async () => (await readHabit(created!.id)).today).toBe(2);
});

test("a habit to avoid: one tap logs a relapse, Deshacer takes it back", async ({
  page,
}, testInfo) => {
  const name = unique("No fumar", testInfo);
  const id = await insertHabit({ name, kind: "avoid", area: "health" });
  await openHabits(page);
  const slip = pad(page, `Registrar recaída: ${name}`);
  await expect(slip).toHaveAttribute("aria-pressed", "false");
  await expect(slip.locator(".bo-key__sub")).toHaveText("8 DÍAS LIMPIO");
  await expect(habitsCount(page)).toHaveText("1 de 1 hoy");

  await untilSaved(page, () => slip.click());
  // No confirmation: logged at once, said without guilt.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(slip).toHaveAttribute("aria-pressed", "true");
  await expect(slip.locator(".bo-key__sub")).toHaveText("EMPIEZAS DE NUEVO HOY");
  await expect(notices(page).getByText(`Anotaste una recaída en «${name}».`)).toBeVisible();
  await expect(habitsCount(page)).toHaveText("0 de 1 hoy");
  await expect.poll(async () => (await readHabit(id)).today).toBe(1);

  if (isDesktop(testInfo)) {
    await untilSaved(page, () => page.keyboard.press("ControlOrMeta+z"));
  } else {
    await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  }
  await expect(slip).toHaveAttribute("aria-pressed", "false");
  await expect(habitsCount(page)).toHaveText("1 de 1 hoy");
  await expect.poll(async () => (await readHabit(id)).today).toBe(0);
});

test("Ajustar el día: the exact quantity from the options, with −/+", async ({
  page,
}, testInfo) => {
  const name = unique("Leer", testInfo);
  const id = await insertHabit({
    name,
    quantity: { goal: 30, unit: "páginas", step: 5, today: 15 },
  });
  await openHabits(page);
  const optionsKey = pads(page).getByRole("button", { name: `Opciones de «${name}»` });
  await optionsKey.click();
  await page.getByRole("dialog", { name }).getByRole("button", { name: "Ajustar el día" }).click();
  const sheet = page.getByRole("dialog", { name: `Ajustar «${name}»` });
  const field = sheet.getByRole("textbox", { name: "Cantidad (páginas)" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("15");
  await sheet.getByRole("button", { name: "Sumar 5" }).click();
  await expect(field).toHaveValue("20");
  await field.fill("12");
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar" }).click());
  await expect(sheet).toBeHidden();
  await expect(optionsKey).toBeFocused();
  await expect(status(page, name)).toHaveText("12/30 PÁGINAS");
  await expect(notices(page).getByText(`«${name}» quedó en 12 de 30 páginas hoy.`)).toBeVisible();
  await expect.poll(async () => (await readHabit(id)).today).toBe(12);

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(status(page, name)).toHaveText("15/30 PÁGINAS");
  await expect.poll(async () => (await readHabit(id)).today).toBe(15);
});

test("at 320 px a quantity's pad and the adjust sheet don't scroll sideways", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await insertHabit({
    name: "Tomar agua",
    quantity: { goal: 10_000, unit: "a".repeat(20), today: 9_999 },
  });
  await insertHabit({ name: "No fumar", kind: "avoid" });
  await page.setViewportSize({ width: 320, height: 640 });
  await openHabits(page);
  await expect(pads(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await pads(page).getByRole("button", { name: "Opciones de «Tomar agua»" }).click();
  await page.getByRole("button", { name: "Ajustar el día" }).click();
  const sheet = page.getByRole("dialog", { name: "Ajustar «Tomar agua»" });
  await expect(sheet.getByRole("textbox")).toBeFocused();
  const box = await sheet.getByRole("button", { name: "Sumar 1" }).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (pads, the form, adjust)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertHabit({
      name: "Tomar agua",
      area: "health",
      quantity: { goal: 8, unit: "vasos", today: 3 },
      sortOrder: 0,
    });
    await insertHabit({
      name: "Medicación",
      quantity: { goal: 2, unit: "veces", today: 2 },
      sortOrder: 1,
    });
    await insertHabit({ name: "No fumar", kind: "avoid", sortOrder: 2 });
    await insertHabit({ name: "No redes", kind: "avoid", done: true, sortOrder: 3 });
    await openHabits(page);
    await setTheme(page, theme);
    expect(await axeViolations(page)).toEqual([]);
    // A tap, then the notice.
    await untilSaved(page, () => pad(page, "Tomar agua").click());
    await expect(notices(page).getByRole("button", { name: "Deshacer" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await page.getByRole("button", { name: "Nuevo hábito" }).click();
    const form = page.getByRole("dialog", { name: "Nuevo hábito" });
    await form.getByRole("radio", { name: "Cantidad" }).click();
    await form.getByRole("button", { name: "Crear hábito" }).click();
    await expect(form.getByRole("textbox", { name: "Meta del día" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(await axeViolations(page)).toEqual([]);
    await form.getByRole("radio", { name: "A evitar" }).click();
    await expect(form.getByText(/Un hábito a evitar se registra con sí o no/)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();

    await pads(page).getByRole("button", { name: "Opciones de «Tomar agua»" }).click();
    await page
      .getByRole("dialog", { name: "Tomar agua" })
      .getByRole("button", { name: "Ajustar el día" })
      .click();
    const adjust = page.getByRole("dialog", { name: "Ajustar «Tomar agua»" });
    await expect(adjust.getByRole("textbox")).toBeFocused();
    expect(await axeViolations(page)).toEqual([]);
    await adjust.getByRole("textbox").fill("x");
    await adjust.getByRole("button", { name: "Guardar" }).click();
    await expect(adjust.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`${theme} theme: "Hoy" with quantities and habits to avoid (reference screenshot)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertHabit({
      name: "Tomar agua",
      area: "health",
      quantity: { goal: 8, unit: "vasos", today: 3 },
      sortOrder: 0,
    });
    await insertHabit({
      name: "Medicación",
      area: "health",
      quantity: { goal: 2, unit: "veces", today: 2 },
      sortOrder: 1,
    });
    await insertHabit({
      name: "Leer",
      area: "learning",
      quantity: { goal: 30, unit: "páginas", step: 5, today: 10 },
      sortOrder: 2,
    });
    await insertHabit({ name: "No fumar", kind: "avoid", sortOrder: 3 });
    await insertHabit({ name: "No redes", kind: "avoid", done: true, sortOrder: 4 });
    await openHabits(page);
    await setTheme(page, theme);
    await expect(habitsCount(page)).toHaveText("2 de 5 hoy");
    await afterSaveSettled(page);
    await expectScreenshot(page.locator("main"), `habits-measure-${theme}.png`, {
      stylePath: SCREENSHOT_CSS,
    });
  });
}
