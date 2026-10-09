import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { ownerDateKey } from "@/lib/time";
import { shiftMonth } from "@/modules/finance/routes";
import { animationsSettled } from "./support/animations";
import {
  expect,
  expenseRow,
  insertCategory,
  insertExpense,
  insertMethod,
  insertRecurring,
  openReady,
  test,
} from "./support/finance";
import { fontsLoaded } from "./support/fonts";
import { isDesktop } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// F3 of `finance`: the month's summary on "Mes" (total with a USD expense, USD without a rate and
// "Fijar tipo de cambio"), the category filter, the month's arrows, reduced motion, 320 px and axe
// in both themes. Every test holds the finance lock (shared data). Made-up names and amounts only.

const THEMES = ["dark", "light"] as const;
const today = () => ownerDateKey(new Date());
const currentMonth = () => today().slice(0, 7);

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

const totalText = (page: Page) => page.locator("[data-month-total] .bo-month-total .sr-only");
const categoryList = (page: Page) => page.getByRole("list", { name: "Por categoría" });
const monthHeading = (page: Page) => page.getByRole("heading", { level: 2 });

/** A month with PEN, USD with its stored rate and USD without one, in two categories. */
async function seedMonth() {
  const efectivo = await insertMethod("Efectivo", "PEN", true);
  const dolares = await insertMethod("Débito dólares", "USD");
  const comida = await insertCategory("Comida");
  const casa = await insertCategory("Casa");
  await insertExpense({
    description: "Mercado",
    amountCents: 4_000,
    spentOn: today(),
    categoryId: comida,
    paymentMethodId: efectivo,
  });
  await insertExpense({
    description: "Suscripción",
    amountCents: 2_000,
    currency: "USD",
    exchangeRate: "3.7500",
    spentOn: today(),
    categoryId: casa,
    paymentMethodId: dolares,
  });
  await insertExpense({
    description: "Hosting",
    amountCents: 1_000,
    currency: "USD",
    spentOn: today(),
    paymentMethodId: dolares,
  });
}

/** The NumberFlow animations running now (they live in its shadow root). */
function numberFlowAnimations(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-month-total] *")]
      .filter((element) => element.shadowRoot)
      .reduce((count, element) => count + element.shadowRoot!.getAnimations().length, 0),
  );
}

test("the summary: total in PEN with a USD expense, USD without a rate apart, Ajustes from there", async ({
  page,
}) => {
  await seedMonth();
  await openReady(page, "/finance");
  // 40.00 + 75.00 (USD 20 × 3.75); USD 10 without a rate is apart.
  await expect(totalText(page)).toHaveText("Total del mes: 115 soles");
  await expect(page.locator("[data-month-total] .bo-stat__value")).toContainText("115.00");
  const unconverted = page.locator("[data-month-unconverted]");
  await expect(unconverted).toContainText("+ USD 10.00 sin convertir");
  await expect(
    categoryList(page)
      .getByRole("button")
      .evaluateAll((bars) => bars.map((bar) => bar.getAttribute("aria-label"))),
  ).resolves.toEqual([
    "Casa, 75 soles, 65 por ciento",
    "Comida, 40 soles, 35 por ciento",
    "Sin categoría, 0 soles, y 10 dólares sin convertir",
  ]);
  const methods = page.getByRole("list", { name: "Por medio de pago" });
  await expect(methods.getByRole("listitem")).toHaveCount(2);
  await expect(methods.getByRole("listitem").first()).toContainText(
    "Débito dólares, 75 soles, y 10 dólares sin convertir",
  );

  // No rate in Ajustes: "Fijar tipo de cambio" opens it; Esc brings focus back to it.
  const setRate = unconverted.getByRole("button", { name: "Fijar tipo de cambio" });
  await setRate.click();
  const settings = page.getByRole("dialog", { name: "Ajustes de Finanzas" });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(setRate).toBeFocused();

  // Setting it there: the stored expense stays "sin convertir" (rates are never rewritten), the
  // key goes away and focus returns to "Ajustes".
  await setRate.click();
  await settings.getByRole("textbox", { name: "Soles por 1 dólar" }).fill("3.80");
  await settings.getByRole("button", { name: "Guardar tipo de cambio" }).click();
  await expect(settings.getByText("Tipo de cambio guardado: S/ 3.80 por dólar.")).toBeAttached();
  await expect(setRate).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(page.getByRole("button", { name: "Ajustes" })).toBeFocused();
  await expect(unconverted).toContainText("+ USD 10.00 sin convertir");
});

test("Pendiente de pagar: the month's pending payments, variable ones apart; it opens Pagos", async ({
  page,
}) => {
  // Both due today (the helper's default), neither paid: pending this month.
  await insertRecurring({ name: "Internet", amountCents: 5_000 });
  await insertRecurring({ name: "Luz", amountCents: null });
  await openReady(page, "/finance");
  const strip = page.getByRole("button", {
    name: "Pendiente de pagar: 50 soles, y 1 de monto variable, 2 pagos. Ver en Pagos",
  });
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("S/ 50.00 + 1 de monto variable");
  await strip.click();
  const tab = page.getByRole("tab", { name: "Pagos" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toBeFocused();
  await expect(page.locator('[data-finance-view="payments"]')).toBeVisible();
  await expect(page.locator('[data-finance-view="month"]')).toBeHidden();
});

test("a category's bar filters the list; Quitar filtro brings the whole month back", async ({
  page,
}) => {
  await seedMonth();
  await openReady(page, "/finance");
  const comida = categoryList(page).getByRole("button", { name: /^Comida,/ });
  await comida.click();
  await expect(comida).toHaveAttribute("aria-pressed", "true");
  await expect(expenseRow(page, "Mercado")).toBeVisible();
  await expect(expenseRow(page, "Suscripción")).toHaveCount(0);
  await expect(expenseRow(page, "Hosting")).toHaveCount(0);
  await expect(page.locator("[data-screen-announcer]")).toHaveText(
    "Lista filtrada por Comida: 1 gasto.",
  );
  await page.getByRole("button", { name: "Quitar filtro" }).click();
  await expect(comida).toBeFocused();
  await expect(comida).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /^Editar / })).toHaveCount(3);
  await expect(page.locator("[data-screen-announcer]")).toHaveText("Sin filtro: 3 gastos del mes.");
});

test("the arrows go to the previous month and back; never past the current one", async ({
  page,
}) => {
  const previous = shiftMonth(currentMonth(), -1);
  await insertExpense({ description: "Libro", amountCents: 3_000, spentOn: `${previous}-15` });
  await insertExpense({ description: "Pan", amountCents: 500, spentOn: today() });
  await openReady(page, "/finance");
  const current = await monthHeading(page).textContent();
  await expect(totalText(page)).toHaveText("Total del mes: 5 soles");
  const next = page.locator('[data-month-arrow="next"]');
  await expect(next).toHaveAttribute("aria-disabled", "true");

  const back = page.locator('[data-month-arrow="previous"]');
  await back.click();
  await expect(page).toHaveURL(new RegExp(`\\?mes=${previous}$`));
  await expect(totalText(page)).toHaveText("Total del mes: 30 soles");
  await expect(expenseRow(page, "Libro")).toBeVisible();
  await expect(expenseRow(page, "Pan")).toHaveCount(0);
  await expect(back).toBeFocused();
  await expect(page.locator("[data-screen-announcer]")).toContainText("30 soles en total.");

  await next.click();
  await expect(page).toHaveURL(/\/finance$/);
  await expect(monthHeading(page)).toHaveText(current ?? "");
  await expect(totalText(page)).toHaveText("Total del mes: 5 soles");
  // The arrow that brought the current month keeps focus, now aria-disabled.
  await expect(next).toBeFocused();
  await expect(next).toHaveAttribute("aria-disabled", "true");
  // Playwright won't click an aria-disabled key: the keyboard does nothing either.
  await next.press("Enter");
  await expect(next).toBeFocused();
  await expect(page).toHaveURL(/\/finance$/);
});

test("the total's digits roll, but never with reduced motion", async ({ page }) => {
  const previous = shiftMonth(currentMonth(), -1);
  await insertExpense({ amountCents: 3_000, spentOn: `${previous}-15` });
  await insertExpense({ amountCents: 500, spentOn: today() });

  const total = page.locator("[data-month-total]");
  // Positive control: with motion, changing the month animates the total. Sampling starts once
  // the new total is rendered (data-month-total holds its PEN cents), when NumberFlow animates.
  await openReady(page, "/finance");
  await expect(total).toHaveAttribute("data-month-total", "500");
  await page.locator('[data-month-arrow="previous"]').click();
  await expect(total).toHaveAttribute("data-month-total", "3000");
  await expect
    .poll(() => numberFlowAnimations(page), { timeout: 3_000, intervals: [20] })
    .toBeGreaterThan(0);
  await expect(totalText(page)).toHaveText("Total del mes: 30 soles");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await openReady(page, "/finance");
  await expect(total).toHaveAttribute("data-month-total", "500");
  await page.locator('[data-month-arrow="previous"]').click();
  await expect(total).toHaveAttribute("data-month-total", "3000");
  // Sampled for a while after the change: nothing moves.
  const samples: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    samples.push(await numberFlowAnimations(page));
    await page.waitForTimeout(30);
  }
  expect(samples.every((count) => count === 0)).toBe(true);
});

test("at 320 px the summary doesn't scroll sideways @responsive", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const method = await insertMethod("Una tarjeta con un nombre bastante largo", "USD");
  const category = await insertCategory("Una categoría con un nombre largo");
  await insertExpense({
    description: "Un gasto grande",
    amountCents: 99_999_999,
    currency: "USD",
    exchangeRate: "3.7500",
    spentOn: today(),
    paymentMethodId: method,
    categoryId: category,
  });
  await insertExpense({ amountCents: 99_999_999, currency: "USD", spentOn: today() });
  await page.setViewportSize({ width: 320, height: 640 });
  await openReady(page, "/finance");
  await expect(page.locator("[data-month-summary]")).toBeVisible();
  await animationsSettled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await categoryList(page).getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "Quitar filtro" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations on the summary (also filtered) @responsive`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedMonth();
    await openReady(page, "/finance");
    await setTheme(page, theme);
    await afterSaveSettled(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expectScreenshot(page.locator("[data-month-summary]"), `finance-summary-${theme}.png`);

    await categoryList(page)
      .getByRole("button", { name: /^Comida,/ })
      .click();
    await expect(page.getByRole("button", { name: "Quitar filtro" })).toBeVisible();
    await afterSaveSettled(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
