import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { insertRecurring, readRecurring, readSettlements } from "./support/finance";
import { fontsLoaded } from "./support/fonts";
import { expect } from "./support/habits";
import { isDesktop, limaDay, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { boardTest as test } from "./support/today-tasks";

// Installments of `finance` on "/" (polish → installments): "Cuota 2 de 3" on the rows of "Pagos",
// paying the 3 from Hoy, the last one archiving the plan with "Deshacer", accessibility in both
// themes and 320 px. Every test is a `boardTest` (the habits, tasks and finance locks, empty
// finance tables): the made-up payments carry the finance lock, so they never show on another
// test's "/". Made-up names and amounts only.

const THEMES = ["dark", "light"] as const;

/** Opens "/" and waits until it is hydrated (taps reach React) and laid out (fonts in). */
async function openToday(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle("Hoy · brahua-os");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await fontsLoaded(page);
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

const section = (page: Page) => page.getByRole("region", { name: "Pagos" });
const rows = (page: Page) =>
  section(page).getByRole("list", { name: "Pagos vencidos y de los próximos 7 días" });
const payKey = (page: Page, name: string) =>
  section(page).getByRole("button", { name: new RegExp(`^Pagado(, con monto)?: ${name},`) });

/**
 * A plan of 3 whose due dates all sit in the pending window: 59 days ago, about a month ago and
 * the third from today to 3 days ahead (two consecutive months add up to 59–62 days).
 */
function plan(name: string) {
  const start = limaDay(-59);
  return insertRecurring({
    name,
    dayOfMonth: Number(start.slice(8, 10)),
    startDate: start,
    installmentsTotal: 3,
  });
}

test("pay the 3 installments from Hoy: Cuota 1 de 3 … 3 de 3, the last one archives the plan and Deshacer brings it back", async ({
  page,
}) => {
  const id = await plan("Notebook");
  await openToday(page);
  const list = rows(page).locator("li");
  await expect(list).toHaveCount(3);
  await expect(list.nth(0)).toContainText("Cuota 1 de 3");
  await expect(list.nth(1)).toContainText("Cuota 2 de 3");
  await expect(list.nth(2)).toContainText("Cuota 3 de 3");
  // Read in words: the name is described with its installment.
  await expect(
    list.nth(1).getByRole("link", { name: "Notebook", exact: true }),
  ).toHaveAccessibleDescription(/Cuota 2 de 3/);

  await untilSaved(page, () => payKey(page, "Notebook").first().click());
  await expect(list).toHaveCount(2);
  await expect(list.first()).toContainText("Cuota 2 de 3");
  await untilSaved(page, () => payKey(page, "Notebook").first().click());
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText("Cuota 3 de 3");
  expect((await readRecurring("Notebook"))?.archivedAt).toBeNull();

  await untilSaved(page, () => payKey(page, "Notebook").first().click());
  const last = notices(page).locator(".bo-toast").filter({ hasText: "Última cuota" });
  await expect(last).toContainText("Última cuota de «Notebook». Se archiva solo.");
  await expect.poll(async () => (await readRecurring("Notebook"))?.archivedAt).not.toBeNull();
  expect(await readSettlements(id)).toHaveLength(3);
  // The server agrees after a reload: nothing left on the board.
  await openToday(page);
  await expect(section(page)).toHaveCount(0);
});

test("Deshacer of the last installment from Hoy puts the row back and reactivates the plan", async ({
  page,
}) => {
  const id = await plan("Notebook");
  await openToday(page);
  for (let paid = 0; paid < 3; paid += 1) {
    await untilSaved(page, () => payKey(page, "Notebook").first().click());
  }
  const last = notices(page).locator(".bo-toast").filter({ hasText: "Última cuota" });
  await expect(last).toBeVisible();
  await expect.poll(async () => (await readRecurring("Notebook"))?.archivedAt).not.toBeNull();
  await untilSaved(page, () => last.getByRole("button", { name: "Deshacer" }).click());
  await expect(rows(page).locator("li")).toHaveCount(1);
  await expect(rows(page).locator("li").first()).toContainText("Cuota 3 de 3");
  await expect.poll(async () => (await readRecurring("Notebook"))?.archivedAt).toBeNull();
  expect(await readSettlements(id)).toHaveLength(2);
  await openToday(page);
  await expect(rows(page).locator("li")).toHaveCount(1);
});

test("at 320 px the rows with installments don't scroll sideways @responsive", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await insertRecurring({
    name: "Un pago en cuotas con un nombre bastante largo para probar",
    amountCents: 99_999_999,
    installmentsTotal: 120,
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await openToday(page);
  await expect(rows(page)).toContainText("Cuota 1 de 120");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

for (const theme of THEMES) {
  test(`${theme} theme: installments on Hoy have no accessibility violations (the rows, the notice)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await plan("Notebook");
    await openToday(page);
    await setTheme(page, theme);
    await expect(rows(page).locator("li")).toHaveCount(3);
    expect(await axeViolations(page)).toEqual([]);
    await untilSaved(page, () => payKey(page, "Notebook").first().click());
    await expect(notices(page).getByText("Pago registrado")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
}
