import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { animationsSettled } from "./support/animations";
import {
  expect,
  financeNotices,
  insertRecurring,
  openPayments,
  openReady,
  payKey,
  readRecurring,
  readRecurringExpenses,
  readSettlements,
  test,
} from "./support/finance";
import { fontsLoaded } from "./support/fonts";
import { isDesktop, limaDay, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// Installments of `finance` (polish → installments): "Termina después de N pagos" in the sheet,
// "Cuota 2 de 3" in Pagos and on the payment's page, the last installment archiving the payment
// with "Deshacer", N below what is settled refused, accessibility in both themes and 320 px.
// Every test holds the finance lock (shared data). Made-up names and amounts only.

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

const pendingList = (page: Page) => page.getByRole("list", { name: "Pendientes" });
const FIELD = "Termina después de N pagos (opcional)";

/**
 * The start of a plan whose first three due dates all sit in the pending window: 59 days ago,
 * about a month ago, and the third from today to 3 days ahead (two consecutive months always add
 * up to 59–62 days, clamped days of the month included).
 */
const planStart = () => limaDay(-59);
const dayOf = (day: string) => Number(day.slice(8, 10));

test("a plan of 3 payments: create it, pay the 3 from Pagos, the last one archives it and Deshacer brings it back", async ({
  page,
}) => {
  await openPayments(page);
  await page.getByRole("button", { name: "Nuevo pago recurrente" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo pago recurrente" });
  await expect(sheet.getByRole("textbox", { name: "Nombre" })).toBeFocused();
  await page.keyboard.type("Notebook de prueba");
  const start = planStart();
  await sheet.getByRole("combobox", { name: "Día del mes" }).selectOption(String(dayOf(start)));
  await sheet.getByLabel("Desde", { exact: true }).fill(start);
  await sheet.getByRole("textbox", { name: "Monto previsto en soles" }).fill("250");
  // Only monthly payments can end after N payments.
  const field = sheet.getByRole("textbox", { name: FIELD });
  await sheet.getByRole("combobox", { name: "Ciclo" }).selectOption("yearly");
  await expect(field).toHaveCount(0);
  await sheet.getByRole("combobox", { name: "Ciclo" }).selectOption("monthly");
  await field.fill("3");
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar" }).click());
  await expect(sheet).toBeHidden();
  const stored = await readRecurring("Notebook de prueba");
  expect(stored).toMatchObject({ cycle: "monthly", installmentsTotal: 3, amountCents: 25_000 });
  await expect(
    page.getByRole("list", { name: "Todos" }).getByRole("link", { name: /Notebook/ }),
  ).toContainText("· 3 cuotas");

  // The 3 installments are pending, numbered by position: never a 4th.
  const rows = pendingList(page).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  for (const [index, label] of ["Cuota 1 de 3", "Cuota 2 de 3", "Cuota 3 de 3"].entries()) {
    await expect(rows.nth(index)).toContainText(label);
  }
  await untilSaved(page, () => payKey(page, "Notebook de prueba").first().click());
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Cuota 2 de 3");
  await untilSaved(page, () => payKey(page, "Notebook de prueba").first().click());
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Cuota 3 de 3");
  expect((await readRecurring("Notebook de prueba"))?.archivedAt).toBeNull();

  await untilSaved(page, () => payKey(page, "Notebook de prueba").first().click());
  const last = financeNotices(page).locator(".bo-toast").filter({ hasText: "Última cuota" });
  await expect(last).toContainText("Última cuota de «Notebook de prueba». Se archiva solo.");
  await expect
    .poll(async () => (await readRecurring("Notebook de prueba"))?.archivedAt)
    .not.toBeNull();
  await expect(page.getByText("Archivados (1)")).toBeVisible();
  await expect(page.getByRole("list", { name: "Todos" })).toHaveCount(0);
  expect(await readSettlements(stored!.id)).toHaveLength(3);

  // Deshacer: the 3rd pay goes and the payment is active again, with the 3rd pending.
  await untilSaved(page, () => last.getByRole("button", { name: "Deshacer" }).click());
  await expect.poll(async () => (await readRecurring("Notebook de prueba"))?.archivedAt).toBeNull();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Cuota 3 de 3");
  await expect(page.getByText(/^Archivados/)).toHaveCount(0);
  expect(await readSettlements(stored!.id)).toHaveLength(2);
  const expenses = await readRecurringExpenses(stored!.id);
  expect(expenses.filter((expense) => expense.deletedAt === null)).toHaveLength(2);
});

test("N below what is settled is refused with the lowest N; equal closes the plan", async ({
  page,
}) => {
  const id = await insertRecurring({
    name: "Cuotas de prueba",
    dayOfMonth: dayOf(planStart()),
    startDate: planStart(),
    installmentsTotal: 3,
  });
  await openPayments(page);
  await untilSaved(page, () => payKey(page, "Cuotas de prueba").first().click());
  await untilSaved(page, () => payKey(page, "Cuotas de prueba").first().click());
  await expect.poll(async () => (await readSettlements(id)).length).toBe(2);

  await openReady(page, `/finance/payments/${id}`);
  await expect(page.getByRole("list", { name: "Próximos vencimientos" })).toContainText(
    "Cuota 3 de 3",
  );
  await page.getByRole("button", { name: "Editar" }).click();
  const sheet = page.getByRole("dialog", { name: "Editar pago recurrente" });
  const field = sheet.getByRole("textbox", { name: FIELD });
  await expect(field).toHaveValue("3");
  await field.fill("1");
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar" }).click());
  await expect(
    sheet.getByText("Ya hay 2 cuotas pagadas u omitidas: escribe 2 o más."),
  ).toBeVisible();
  await expect(field).toBeFocused();
  expect((await readRecurring("Cuotas de prueba"))?.installmentsTotal).toBe(3);

  // Positive control: equal to what is settled is saved, and it closes the plan.
  await field.fill("2");
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar" }).click());
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Archivado", { exact: true })).toBeVisible();
  expect(await readRecurring("Cuotas de prueba")).toMatchObject({ installmentsTotal: 2 });
  expect((await readRecurring("Cuotas de prueba"))?.archivedAt).not.toBeNull();
});

test("skipping the last installment also archives the plan, and says so", async ({ page }) => {
  const start = limaDay(-28);
  const id = await insertRecurring({
    name: "Cuotas omitidas",
    dayOfMonth: dayOf(start),
    startDate: start,
    installmentsTotal: 2,
  });
  await openPayments(page);
  await untilSaved(page, () => payKey(page, "Cuotas omitidas").first().click());
  await page.getByRole("button", { name: "Más acciones de Cuotas omitidas" }).click();
  const sheet = page.getByRole("dialog", { name: "Registrar pago de Cuotas omitidas" });
  await untilSaved(page, () => sheet.getByRole("button", { name: "Omitir este período" }).click());
  const last = financeNotices(page).locator(".bo-toast").filter({ hasText: "Última cuota" });
  await expect(last).toContainText("Última cuota de «Cuotas omitidas». Se archiva solo.");
  await expect
    .poll(async () => (await readRecurring("Cuotas omitidas"))?.archivedAt)
    .not.toBeNull();
  expect((await readSettlements(id)).map((row) => row.status).sort()).toEqual(["paid", "skipped"]);
  await untilSaved(page, () => last.getByRole("button", { name: "Deshacer" }).click());
  await expect.poll(async () => (await readRecurring("Cuotas omitidas"))?.archivedAt).toBeNull();
  await expect(payKey(page, "Cuotas omitidas")).toBeVisible();
});

test("at 320 px the field, the rows and the page with installments don't scroll sideways", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const id = await insertRecurring({
    name: "Un pago en cuotas con un nombre bastante largo para probar",
    amountCents: 99_999_999,
    installmentsTotal: 120,
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await openPayments(page);
  const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await scrollWidth()).toBeLessThanOrEqual(320);
  await expect(pendingList(page)).toContainText("Cuota 1 de 120");
  await page.getByRole("button", { name: "Nuevo pago recurrente" }).click();
  const create = page.getByRole("dialog", { name: "Nuevo pago recurrente" });
  await expect(create.getByRole("textbox", { name: FIELD })).toBeVisible();
  await animationsSettled(page);
  const body = create.locator(".bo-sheet__body");
  expect(await body.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await openReady(page, `/finance/payments/${id}`);
  await expect(page.getByRole("list", { name: "Próximos vencimientos" })).toContainText(
    "Cuota 1 de 120",
  );
  expect(await scrollWidth()).toBeLessThanOrEqual(320);
  expect(await axeViolations(page)).toEqual([]);
});

for (const theme of THEMES) {
  test(`${theme} theme: installments have no accessibility violations (the row, the sheet and its error, the page)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Due today and cuota 1 of 3: the labels read the same every day (reference screenshot).
    const id = await insertRecurring({ name: "Notebook", installmentsTotal: 3 });
    await openReady(page, "/finance");
    await setTheme(page, theme);
    await page.getByRole("tab", { name: "Pagos" }).click();
    await expect(pendingList(page)).toContainText("Cuota 1 de 3");
    expect(await axeViolations(page)).toEqual([]);
    await expectScreenshot(pendingList(page), `finance-installments-pending-${theme}.png`);

    await page.getByRole("button", { name: "Nuevo pago recurrente" }).click();
    const sheet = page.getByRole("dialog", { name: "Nuevo pago recurrente" });
    await sheet.getByRole("textbox", { name: FIELD }).fill("0");
    await sheet.getByRole("button", { name: "Guardar" }).click();
    await expect(
      sheet.getByText("Escribe un número entero de cuotas, del 1 al 120."),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");

    await openReady(page, `/finance/payments/${id}`);
    await expect(page.getByRole("list", { name: "Próximos vencimientos" })).toContainText(
      "Cuota 1 de 3",
    );
    expect(await axeViolations(page)).toEqual([]);
  });
}
