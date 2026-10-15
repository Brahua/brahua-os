import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { ownerDateKey } from "@/lib/time";
import { shiftMonth } from "@/modules/finance/routes";
import {
  expect,
  expenseRow,
  insertCategory,
  insertExpense,
  openReady,
  test,
} from "./support/finance";
import { fontsLoaded } from "./support/fonts";
import { afterSaveSettled } from "./support/saves";

// finance-gastos: the one E2E of the module. «Gastos» of a month with 9 days of expenses (the
// previous month, so the days exist on any run date): «Mostrar 7 días más», the filters panel
// (text, category, amount), the chips, the line of what the filters leave (the month's total never
// moves), the order by amount (a flat list) and «Quitar todos». Then axe in both themes and 320 px.
// Made-up data only. Every test holds the finance lock (shared data).

const THEMES = ["dark", "light"] as const;
const month = () => shiftMonth(ownerDateKey(new Date()).slice(0, 7), -1);

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
}

/** 9 days of one expense each (S/ 11…19), odd ones in «Comida»; day 3 is «Café», 25 soles. */
async function seed() {
  const comida = await insertCategory("Comida");
  const casa = await insertCategory("Casa");
  let total = 0;
  for (let day = 1; day <= 9; day += 1) {
    const cafe = day === 3;
    const amountCents = cafe ? 2_500 : 1_000 + day * 100;
    total += amountCents;
    await insertExpense({
      description: cafe ? "Café" : `Gasto ${day}`,
      amountCents,
      spentOn: `${month()}-${String(day).padStart(2, "0")}`,
      categoryId: day % 2 === 1 ? comida : casa,
    });
  }
  return total;
}

const rows = (page: Page) => page.getByRole("button", { name: /^Editar / });

async function openMonth(page: Page) {
  await openReady(page, `/finance?mes=${month()}`);
  await page.getByRole("tab", { name: "Gastos" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Gastos del mes" })).toBeVisible();
}

test("pages by day, filters by text, category and amount, sorts by amount and clears everything (reduced motion)", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const total = await seed();
  await openMonth(page);
  const monthTotal = page.locator("[data-month-total]");
  await expect(monthTotal).toHaveAttribute("data-month-total", String(total));

  // Pages: 7 days, then the rest; the button goes away with nothing left.
  await expect(rows(page)).toHaveCount(7);
  await expect(page.getByText("Mostrando 7 de 9 días")).toBeVisible();
  await page.getByRole("button", { name: "Mostrar 7 días más" }).click();
  await expect(rows(page)).toHaveCount(9);
  await expect(page.getByRole("button", { name: /Mostrar 7 días más/ })).toHaveCount(0);

  // Text, accents and case ignored; what is left is said, the month's total does not move.
  await page.getByRole("button", { name: "Filtros" }).click();
  await page.getByRole("searchbox", { name: /^Buscar en descripción/ }).fill("CAFE");
  await expect(rows(page)).toHaveCount(1);
  await expect(expenseRow(page, "Café")).toBeVisible();
  await expect(page.locator("[data-filter-result]")).toContainText("1 gasto · S/ 25.00");
  await expect(page.getByRole("button", { name: "Quitar filtro: “CAFE”" })).toBeVisible();
  await expect(monthTotal).toHaveAttribute("data-month-total", String(total));
  await page.getByRole("button", { name: "Quitar filtro: “CAFE”" }).click();
  // Changing the filters starts the pages over: the first 7 days again.
  await expect(rows(page)).toHaveCount(7);

  // A category (a set) and a range of amount.
  await page.getByRole("group", { name: "Categoría" }).getByLabel("Casa").check();
  await expect(rows(page)).toHaveCount(4); // days 2, 4, 6, 8
  await page.getByRole("textbox", { name: "Desde", exact: true }).fill("13");
  await expect(rows(page)).toHaveCount(3); // S/ 14, 16, 18 (S/ 12 is out)
  await expect(page.locator("[data-filter-result]")).toContainText("3 gastos · S/ 48.00");

  // By amount the list is flat and starts with the highest.
  await page.getByRole("combobox", { name: "Orden" }).selectOption("highest");
  await expect(page.getByRole("heading", { level: 4 })).toHaveCount(0);
  await expect(rows(page).first()).toHaveAccessibleName(/^Editar Gasto 8,/);
  await page.getByRole("combobox", { name: "Orden" }).selectOption("recent");

  // «Quitar todos» brings the whole month back and hands focus to «Filtros».
  await page.getByRole("button", { name: "Quitar todos" }).click();
  await expect(rows(page)).toHaveCount(7);
  await expect(page.getByRole("button", { name: "Filtros" })).toBeFocused();
  await expect(monthTotal).toHaveAttribute("data-month-total", String(total));
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations with the panel open and filtering; at 320 px nothing scrolls sideways @responsive`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seed();
    await page.setViewportSize({ width: 320, height: 640 });
    await openMonth(page);
    await setTheme(page, theme);
    await page.getByRole("tab", { name: "Gastos" }).click();
    const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
    await page.getByRole("button", { name: "Filtros" }).click();
    await page.getByRole("group", { name: "Categoría" }).getByLabel("Comida").check();
    await page.getByRole("textbox", { name: "Desde", exact: true }).fill("12");
    await expect(page.locator("[data-month-filter]")).toBeVisible();
    await afterSaveSettled(page);
    expect(await scrollWidth()).toBeLessThanOrEqual(320);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
