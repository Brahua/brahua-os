import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { ownerDateKey } from "@/lib/time";
import { shiftMonth } from "@/modules/finance/routes";
import {
  amountField,
  expect,
  expenseRow,
  expenseSheet,
  expenseStatus,
  financeNotices,
  insertCategory,
  insertExpense,
  insertMethod,
  insertRecurring,
  openReady,
  readAllExpenses,
  test,
} from "./support/finance";
import { fontsLoaded } from "./support/fonts";
import { afterSaveSettled } from "./support/saves";

// finance-motion (M5): the one E2E of the module. It walks the redesigned /finance with reduced
// motion (the final state is deterministic): the three sections, the month's arrows, the category
// filter and its chip, registering an expense, and «Pagado» (the total pulses, «Recurrentes» says it). Then axe in both
// themes on «Resumen» and «Gastos», and nothing scrolling sideways at 320 px. Made-up data only.
// Every test holds the finance lock (shared data).

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

const categoryList = (page: Page) => page.getByRole("list", { name: "Por categoría" });
const tab = (page: Page, name: string) => page.getByRole("tab", { name });

async function seed() {
  const efectivo = await insertMethod("Efectivo", "PEN", true);
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
    description: "Alquiler",
    amountCents: 8_000,
    spentOn: today(),
    categoryId: casa,
    paymentMethodId: efectivo,
  });
  const previous = shiftMonth(currentMonth(), -1);
  await insertExpense({
    description: "Libro",
    amountCents: 3_000,
    spentOn: `${previous}-15`,
    categoryId: comida,
  });
}

test("the three sections, the month's arrows, the filter chip, a new expense and «Pagado» (reduced motion)", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed();
  await insertRecurring({ name: "Internet", amountCents: 5_000 });
  await openReady(page, "/finance");

  // «Resumen»: the total, the pace chart and the breakdown (no other section is showing).
  await expect(tab(page, "Resumen")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Ritmo del mes" })).toBeVisible();
  await expect(
    page.getByRole("img", { name: /^Gasto acumulado del mes: 120 soles/ }),
  ).toBeVisible();
  await expect(page.locator("[data-stacked-bar]")).toBeVisible();
  await expect(expenseRow(page, "Mercado")).toHaveCount(0);

  // The chart answers the keyboard: ← says the day before.
  await page.getByRole("img", { name: /^Gasto acumulado/ }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("[data-chart-tooltip]")).toContainText("S/");

  // The month's arrows: last month has one expense, and the content follows.
  const back = page.locator('[data-month-arrow="previous"]');
  await back.click();
  await expect(page).toHaveURL(/\?mes=/);
  await expect(page.locator("[data-month-total]")).toHaveAttribute("data-month-total", "3000");
  await expect(back).toBeFocused();
  await page.locator('[data-month-arrow="next"]').click();
  await expect(page).toHaveURL(/\/finance$/);
  await expect(page.locator("[data-month-total]")).toHaveAttribute("data-month-total", "12000");

  // A category in the list takes you to «Gastos» with its chip; the chip's key clears it.
  await categoryList(page)
    .getByRole("button", { name: /^Casa,/ })
    .click();
  await expect(tab(page, "Gastos")).toHaveAttribute("aria-selected", "true");
  await expect(expenseRow(page, "Alquiler")).toBeVisible();
  await expect(expenseRow(page, "Mercado")).toHaveCount(0);
  await expect(page.locator("[data-month-filter]")).toContainText("Solo Casa · 1 gasto");
  await page.getByRole("button", { name: "Quitar filtro" }).click();
  await expect(page.locator("[data-month-filter]")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Gastos del mes" })).toBeFocused();
  await expect(expenseRow(page, "Mercado")).toBeVisible();
  // Each day shows its total.
  await expect(page.locator(`[data-day-total="${today()}"]`)).toContainText("120.00");

  // Registering an expense: the sheet saves, and its row arrives in «Gastos».
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(amountField(page)).toBeFocused();
  await page.keyboard.type("7,50");
  await page.keyboard.press("Enter");
  await expect(expenseStatus(page)).toHaveText("Registrado: 7.50 soles.");
  await page.keyboard.press("Escape");
  await expect(expenseSheet(page)).toBeHidden();
  await expect.poll(async () => (await readAllExpenses()).length).toBe(4);
  await expect(expenseRow(page, "Sin categoría")).toHaveCount(1);

  // «Pagado»: «Por pagar» sits in «Gastos» under the total; one tap pays it and the total pulses.
  await expect(page.getByRole("heading", { level: 3, name: "Por pagar" })).toBeVisible();
  await page.getByRole("button", { name: /^Pagado: Internet,/ }).click();
  await expect(page.locator("[data-month-total]")).toHaveAttribute("data-paid-pulse", /.+/, {
    timeout: 5_000,
  });
  await expect(financeNotices(page)).toContainText("Pago registrado");
  // «Recurrentes» says this month's state of the payment.
  await tab(page, "Recurrentes").click();
  await expect(
    page.getByRole("list", { name: "Pagos recurrentes" }).getByRole("link", { name: /Internet/ }),
  ).toContainText("Pagado · S/ 50.00");
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations on «Resumen» and «Gastos»; at 320 px nothing scrolls sideways @responsive`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed();
    await page.setViewportSize({ width: 320, height: 640 });
    await openReady(page, "/finance");
    await setTheme(page, theme);
    await afterSaveSettled(page);
    const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
    expect(await scrollWidth()).toBeLessThanOrEqual(320);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await tab(page, "Gastos").click();
    await expect(expenseRow(page, "Mercado")).toBeVisible();
    await afterSaveSettled(page);
    expect(await scrollWidth()).toBeLessThanOrEqual(320);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
