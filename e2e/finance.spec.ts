import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { ownerDateKey } from "@/lib/time";
import { animationsSettled } from "./support/animations";
import {
  amountField,
  captureKey,
  expect,
  expenseRow,
  expenseSheet,
  expenseStatus,
  financeNotices,
  insertCategory,
  insertExpense,
  insertMethod,
  openReady,
  readAllExpenses,
  readExpenses,
  test,
} from "./support/finance";
import { fontsLoaded } from "./support/fonts";
import { isDesktop, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// F1 of `finance`: the quick capture's "Gasto" (≤ 3 interactions and < 10 s on the phone, with
// "Deshacer"), /finance "Mes" (edit, delete and undo), "Ajustes" (rate, categories, methods),
// accessibility in both themes and 320 px. Every test holds the finance lock (shared data).

const THEMES = ["dark", "light"] as const;
const today = () => ownerDateKey(new Date());
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

/** Screenshots over "/": its board shows every module's rows, whoever created them. */
const TODAY_BOARD_HIDDEN_CSS = path.join(__dirname, "support/today-board-hidden.css");

const switcher = (page: Page) => page.getByRole("radiogroup", { name: "Qué capturar" });

// The first capture on a device is 4 interactions (key, "Gasto", amount, Enter); once the device
// remembers "Gasto", 3 (decisión autónoma para revisar con el owner, SPEC-finance "Captura rápida").
test("phone: with Gasto remembered, an expense in 3 interactions and under 10 s, with Deshacer", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "The orange key of the bottom bar");
  await insertMethod("Efectivo", "PEN", true);
  await openReady(page, "/projects");

  // The first time, "Gasto" is picked in the switch (the device remembers it).
  await captureKey(page).click();
  await expect(page.getByRole("dialog", { name: "Nueva tarea" })).toBeVisible();
  await switcher(page).getByRole("radio", { name: "Gasto" }).click();
  await expect(amountField(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(expenseSheet(page)).toBeHidden();

  // From then on: the key, the amount, Enter.
  const started = Date.now();
  await captureKey(page).click(); // 1
  await expect(amountField(page)).toBeFocused();
  await expect(amountField(page)).toHaveAttribute("inputmode", "decimal");
  await page.keyboard.type("12,50"); // 2
  await page.keyboard.press("Enter"); // 3
  await expect(expenseStatus(page)).toHaveText("Registrado: 12.50 soles.");
  expect(Date.now() - started).toBeLessThan(10_000);
  // Ready for the next one.
  await expect(amountField(page)).toHaveValue("");
  await expect(amountField(page)).toBeFocused();
  // Saved with the defaults: today, the last method, PEN, no category.
  const [saved] = await readAllExpenses();
  expect(saved).toMatchObject({
    amountCents: 1250,
    currency: "PEN",
    spentOn: today(),
    categoryId: null,
    description: null,
  });
  expect(saved.paymentMethodId).not.toBeNull();

  // "Deshacer" in the sheet removes it.
  await expenseSheet(page).getByRole("button", { name: "Deshacer" }).click();
  await expect(expenseStatus(page)).toHaveText("Se quitó el gasto.");
  await expect.poll(async () => (await readAllExpenses())[0].deletedAt).not.toBeNull();

  // Another one, then it is in the month.
  await expect(amountField(page)).toBeFocused();
  await page.keyboard.type("4.20");
  await amountField(page).press("Enter");
  await expect(expenseStatus(page)).toHaveText("Registrado: 4.20 soles.");
  await page.keyboard.press("Escape");
  await page.locator(".bo-bottomnav--fixed").getByRole("button", { name: "Más" }).click();
  await page
    .getByRole("navigation", { name: "Más secciones" })
    .getByRole("link", { name: "Finanzas" })
    .click();
  await expect(page).toHaveURL("/finance");
  await expect(expenseRow(page, "Sin categoría")).toHaveCount(1);
  await expect(expenseRow(page, "Sin categoría")).toHaveAccessibleName(/4\.20 soles/);
});

test("the switch by keyboard keeps focus on it; Esc after a switch returns focus to the key", async ({
  page,
}) => {
  await insertMethod("Efectivo", "PEN", true);
  await openReady(page, "/projects");
  await captureKey(page).click();
  await expect(page.getByRole("dialog", { name: "Nueva tarea" })).toBeVisible();
  await switcher(page).getByRole("radio", { name: "Tarea" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(expenseSheet(page)).toBeVisible();
  // WCAG 3.2.2: the radio group keeps focus (on the new sheet's checked option).
  await expect(switcher(page).getByRole("radio", { name: "Gasto" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(expenseSheet(page)).toBeHidden();
  await expect(captureKey(page)).toBeFocused();
});

test("desktop: C opens the capture; the device remembers Gasto; Más sets category and date", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "The C shortcut is for the desktop");
  await insertMethod("Efectivo", "PEN", true);
  await insertCategory("Comida");
  await openReady(page, "/habits");
  await page.keyboard.press("c");
  await switcher(page).getByRole("radio", { name: "Gasto" }).click();
  await expect(amountField(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(expenseSheet(page)).toBeHidden();

  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await page.keyboard.press("c");
  await expect(amountField(page)).toBeFocused();
  await expect(switcher(page).getByRole("radio", { name: "Gasto" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.type("30");
  await expenseSheet(page)
    .getByRole("textbox", { name: "Descripción (opcional)" })
    .fill("Almuerzo");
  await expenseSheet(page).getByRole("button", { name: "Más" }).click();
  await expenseSheet(page).getByRole("combobox", { name: "Categoría" }).selectOption("Comida");
  const yesterday = new Date(Date.now() - 86_400_000);
  await expenseSheet(page).getByLabel("Fecha").fill(ownerDateKey(yesterday));
  await expenseSheet(page).getByRole("button", { name: "Guardar" }).click();
  await expect(expenseStatus(page)).toHaveText("Registrado: 30 soles · Almuerzo.");
  const [saved] = await readExpenses("Almuerzo");
  expect(saved).toMatchObject({ amountCents: 3000, spentOn: ownerDateKey(yesterday) });
  expect(saved.categoryId).not.toBeNull();

  // Back to "Tarea": the tasks capture is still the same sheet.
  await switcher(page).getByRole("radio", { name: "Tarea" }).click();
  await expect(
    page.getByRole("dialog", { name: "Nueva tarea" }).getByRole("textbox", {
      name: "¿Qué hay que hacer?",
    }),
  ).toBeFocused();
});

test("edit an expense from the month; delete it and undo", async ({ page }) => {
  const methodId = await insertMethod("Crédito", "PEN");
  await insertExpense({
    description: "Mercado",
    amountCents: 8_000,
    spentOn: today(),
    paymentMethodId: methodId,
  });
  await insertExpense({ description: "Pan", amountCents: 450, spentOn: today() });
  await openReady(page, "/finance");
  await expect(expenseRow(page, "Mercado")).toHaveAccessibleName(
    "Editar Mercado, 80 soles, Crédito",
  );

  await expenseRow(page, "Mercado").click();
  const sheet = expenseSheet(page, "Editar gasto");
  await expect(sheet.getByRole("textbox", { name: "Monto" })).toHaveValue("80");
  await sheet.getByRole("textbox", { name: "Monto" }).fill("85.90");
  await sheet.getByRole("textbox", { name: "Descripción (opcional)" }).fill("Mercado central");
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar" }).click());
  await expect(sheet).toBeHidden();
  await expect(expenseRow(page, "Mercado central")).toHaveAccessibleName(/85\.90 soles/);
  await expect(expenseRow(page, "Mercado central")).toBeFocused();
  expect((await readExpenses("Mercado central"))[0].amountCents).toBe(8_590);

  // A new date moves the row to another day (a new element): focus follows it.
  await expenseRow(page, "Mercado central").click();
  const yesterday = new Date(Date.now() - 86_400_000);
  // Only when yesterday is still this month (the row stays on the page).
  if (ownerDateKey(yesterday).slice(0, 7) === today().slice(0, 7)) {
    await expenseSheet(page, "Editar gasto").getByLabel("Fecha").fill(ownerDateKey(yesterday));
    await untilSaved(page, () =>
      expenseSheet(page, "Editar gasto").getByRole("button", { name: "Guardar" }).click(),
    );
    await expect(expenseSheet(page, "Editar gasto")).toBeHidden();
    await expect(page.getByRole("list", { name: "Ayer" }).getByRole("button")).toHaveCount(1);
    await expect(expenseRow(page, "Mercado central")).toBeFocused();
  } else {
    await page.keyboard.press("Escape");
  }

  // Delete: gone at once, focus on the next row, "Deshacer" brings it back.
  await expenseRow(page, "Mercado central").click();
  await expenseSheet(page, "Editar gasto").getByRole("button", { name: "Eliminar gasto" }).click();
  await expect(expenseRow(page, "Mercado central")).toHaveCount(0);
  await expect(expenseRow(page, "Pan")).toBeFocused();
  await expect(financeNotices(page).getByText("Gasto eliminado")).toBeVisible();
  await expect
    .poll(async () => (await readExpenses("Mercado central"))[0].deletedAt)
    .not.toBeNull();
  await untilSaved(page, () =>
    financeNotices(page).getByRole("button", { name: "Deshacer" }).click(),
  );
  await expect(expenseRow(page, "Mercado central")).toHaveCount(1);
  await page.reload();
  await expect(expenseRow(page, "Mercado central")).toHaveCount(1);
  expect((await readExpenses("Mercado central"))[0].deletedAt).toBeNull();
});

test("Ajustes: the rate, a category (new, archived, back) and a method in dollars", async ({
  page,
}) => {
  await openReady(page, "/finance");
  await page.getByRole("button", { name: "Ajustes" }).click();
  const sheet = page.getByRole("dialog", { name: "Ajustes de Finanzas" });
  await expect(sheet).toBeVisible();

  await sheet.getByRole("textbox", { name: "Soles por 1 dólar" }).fill("3,75");
  await sheet.getByRole("button", { name: "Guardar tipo de cambio" }).click();
  await expect(sheet.locator("[data-settings-status]")).toHaveText(
    "Tipo de cambio guardado: S/ 3.75 por dólar.",
  );

  const categories = sheet.getByRole("list", { name: "Categorías" });
  await sheet.getByRole("textbox", { name: "Nueva categoría" }).fill("Mascotas");
  await sheet.getByRole("textbox", { name: "Nueva categoría" }).press("Enter");
  await expect(categories.getByText("Mascotas")).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Nueva categoría" })).toBeFocused();
  await sheet.getByRole("button", { name: "Archivar «Mascotas»" }).click();
  await expect(sheet.getByText("Todavía no hay categorías.")).toBeVisible();
  await sheet.getByRole("button", { name: "Archivadas (1)" }).click();
  await sheet.getByRole("button", { name: "Reactivar «Mascotas»" }).click();
  await expect(sheet.getByRole("list", { name: "Categorías" }).getByText("Mascotas")).toBeVisible();

  await sheet.getByRole("textbox", { name: "Nuevo medio de pago" }).fill("Débito dólares");
  await sheet
    .getByRole("radiogroup", { name: "Moneda por defecto" })
    .getByRole("radio", { name: "Dólares" })
    .click();
  await sheet
    .locator('[data-catalog-new="methods"]')
    .getByRole("button", { name: "Agregar" })
    .click();
  await expect(sheet.getByRole("list", { name: "Medios de pago" })).toContainText("Débito dólares");
  await page.keyboard.press("Escape");

  // A new expense with that method is in dollars, converted with the stored rate.
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await expenseSheet(page).getByRole("button", { name: "Más" }).click();
  await expenseSheet(page)
    .getByRole("combobox", { name: "Medio de pago" })
    .selectOption("Débito dólares");
  await expect(expenseSheet(page).getByRole("radio", { name: "Dólares" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(expenseSheet(page).getByRole("textbox", { name: "Monto en dólares" })).toBeVisible();
  await amountField(page).fill("20");
  await amountField(page).press("Enter");
  await expect(expenseStatus(page)).toHaveText("Registrado: 20 dólares, unos 75 soles.");
  await page.keyboard.press("Escape");
  await expect(expenseRow(page, "Sin categoría")).toHaveAccessibleName(
    "Editar Sin categoría, 20 dólares, unos 75 soles, Débito dólares",
  );
  const [saved] = await readAllExpenses();
  expect(saved).toMatchObject({ currency: "USD", exchangeRate: "3.7500" });
});

test("at 320 px nothing scrolls sideways (the month, the sheets)", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const methodId = await insertMethod("Una tarjeta con un nombre bastante largo", "USD");
  await insertCategory("Una categoría con un nombre largo");
  await insertExpense({
    description: "Una descripción larga de un gasto de prueba",
    amountCents: 99_999_999,
    currency: "USD",
    exchangeRate: "3.7500",
    spentOn: today(),
    paymentMethodId: methodId,
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await openReady(page, "/finance");
  const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await scrollWidth()).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "Ajustes" }).click();
  await expect(page.getByRole("dialog", { name: "Ajustes de Finanzas" })).toBeVisible();
  expect(await scrollWidth()).toBeLessThanOrEqual(320);
  const settingsBody = page
    .getByRole("dialog", { name: "Ajustes de Finanzas" })
    .locator(".bo-sheet__body");
  expect(await settingsBody.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expenseRow(page, "Una descripción larga de un gasto de prueba").click();
  const edit = expenseSheet(page, "Editar gasto");
  await expect(edit).toBeVisible();
  await expect(
    edit
      .getByRole("combobox", { name: "Categoría" })
      .getByRole("option", { name: "Una categoría con un nombre largo" }),
  ).toBeAttached();
  await animationsSettled(page);
  const body = edit.locator(".bo-sheet__body");
  expect(await body.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(edit).toBeHidden();

  // The capture's Gasto with "Más" open.
  await page.evaluate(() => localStorage.setItem("bo_capture_kind", "finance"));
  await captureKey(page).click();
  await expect(amountField(page)).toBeFocused();
  await expenseSheet(page).getByRole("button", { name: "Más" }).click();
  await expect(
    expenseSheet(page)
      .getByRole("combobox", { name: "Categoría" })
      .getByRole("option", { name: "Una categoría con un nombre largo" }),
  ).toBeAttached();
  await animationsSettled(page);
  const captureBody = expenseSheet(page).locator(".bo-sheet__body");
  expect(await captureBody.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await scrollWidth()).toBeLessThanOrEqual(320);
});

test("with reduced motion the sheet opens without moving", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openReady(page, "/finance");
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(amountField(page)).toBeFocused();
  // Reduced motion shortens the slide to 1 ms (extensions.css): within a few frames the sheet is
  // in place; the full slide (--duration-panel / --duration-sheet) would still be moving.
  await expect
    .poll(() => expenseSheet(page).evaluate((element) => getComputedStyle(element).transform), {
      timeout: 120,
      intervals: [20],
    })
    .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (month, edit, Ajustes, capture with an error)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const methodId = await insertMethod("Débito dólares", "USD", true);
    await insertCategory("Comida");
    await insertExpense({
      description: "Café",
      amountCents: 1_250,
      spentOn: today(),
      paymentMethodId: methodId,
    });
    await insertExpense({
      amountCents: 9_500,
      currency: "USD",
      exchangeRate: "3.7500",
      spentOn: today(),
    });
    await openReady(page, "/finance");
    await setTheme(page, theme);
    expect(await axeViolations(page)).toEqual([]);

    await expenseRow(page, "Café").click();
    await expect(expenseSheet(page, "Editar gasto")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Ajustes" }).click();
    await expect(page.getByRole("dialog", { name: "Ajustes de Finanzas" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");

    await captureKey(page).click();
    await switcher(page).getByRole("radio", { name: "Gasto" }).click();
    await expect(amountField(page)).toBeFocused();
    await expenseSheet(page).getByRole("button", { name: "Más" }).click();
    await amountField(page).press("Enter");
    await expect(amountField(page)).toHaveAttribute("aria-invalid", "true");
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`${theme} theme: the capture's Gasto sheet (reference screenshot)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertMethod("Efectivo", "PEN", true);
    await openReady(page, "/");
    await page.evaluate(() => localStorage.setItem("bo_capture_kind", "finance"));
    await setTheme(page, theme);
    await captureKey(page).click();
    await expect(amountField(page)).toBeFocused();
    // The catalog loaded (the method is there, under "Más").
    await expect(
      expenseSheet(page)
        .getByRole("combobox", { name: "Medio de pago", includeHidden: true })
        .getByRole("option", {
          name: "Efectivo",
          includeHidden: true,
        }),
    ).toBeAttached();
    await animationsSettled(page);
    await expectScreenshot(expenseSheet(page), `finance-capture-${theme}.png`, {
      stylePath: TODAY_BOARD_HIDDEN_CSS,
    });
  });
}
