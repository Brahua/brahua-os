import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { ownerDateKey } from "@/lib/time";
import { animationsSettled } from "./support/animations";
import {
  expect,
  financeNotices,
  insertMethod,
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
import { isDesktop, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// F2 of `finance`: "Pagos" (pay one tap and undo, a variable amount through "Pagado…", skip), a
// new yearly payment, the payment's page (archive, delete and undo), accessibility in both
// themes, 320 px and reduced motion. Every test holds the finance lock (shared data). Made-up
// names and amounts only.

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

const pendingList = (page: Page) => page.getByRole("list", { name: "Pendientes" });

test("pay a monthly payment with one tap and undo it", async ({ page }) => {
  const methodId = await insertMethod("Tarjeta de prueba");
  const id = await insertRecurring({ name: "Internet", paymentMethodId: methodId });
  // Due today too: sorted by date, then name, "Agua" comes before "Internet".
  await insertRecurring({ name: "Agua" });
  await openPayments(page);
  await expect(pendingList(page).getByRole("listitem")).toHaveCount(2);
  await expect(pendingList(page).getByText("Vence hoy", { exact: true }).first()).toBeVisible();

  await untilSaved(page, () => payKey(page, "Internet").click());
  // Gone, with focus on the other row's key, and "Deshacer" in the notices.
  await expect(payKey(page, "Internet")).toHaveCount(0);
  await expect(payKey(page, "Agua")).toBeFocused();
  await expect(financeNotices(page).getByText("Pago registrado")).toBeVisible();
  await expect.poll(async () => (await readSettlements(id)).length).toBe(1);
  const [expense] = await readRecurringExpenses(id);
  expect(expense).toMatchObject({
    description: "Internet",
    amountCents: 5_000,
    spentOn: today(),
    paymentMethodId: methodId,
    recurringDueOn: today(),
  });
  await expect(
    page.getByRole("list", { name: /^Este mes/ }).getByText("Pagado · S/ 50.00"),
  ).toBeVisible();

  await untilSaved(page, () =>
    financeNotices(page).getByRole("button", { name: "Deshacer" }).click(),
  );
  await expect(payKey(page, "Internet")).toHaveCount(1);
  await expect.poll(async () => (await readSettlements(id)).length).toBe(0);
  expect((await readRecurringExpenses(id))[0].deletedAt).not.toBeNull();
  // The expense is out of the month too.
  await page.getByRole("tab", { name: "Mes" }).click();
  await expect(page.getByRole("button", { name: /^Editar Internet,/ })).toHaveCount(0);
});

test("a variable amount through Pagado…, and the expense shows as Recurrente", async ({ page }) => {
  const id = await insertRecurring({ name: "Luz", amountCents: null });
  await openPayments(page);
  await expect(payKey(page, "Luz")).toHaveText("Pagado…");
  await payKey(page, "Luz").click();
  const sheet = page.getByRole("dialog", { name: "Registrar pago de Luz" });
  const amount = sheet.getByRole("textbox", { name: "Monto pagado en soles" });
  await expect(amount).toBeFocused();
  await amount.press("Enter");
  await expect(sheet.getByText("Escribe el monto.")).toBeVisible();
  await amount.fill("1080,50");
  await untilSaved(page, () => amount.press("Enter"));
  await expect(sheet).toBeHidden();
  await expect.poll(async () => (await readRecurringExpenses(id)).length).toBe(1);
  expect((await readRecurringExpenses(id))[0].amountCents).toBe(108_050);

  // In "Mes" its row says "Recurrente" and its sheet links to the payment's page.
  await page.getByRole("tab", { name: "Mes" }).click();
  const row = page.getByRole("button", { name: /^Editar Luz,/ });
  await expect(row).toHaveAccessibleName(/Recurrente/);
  await row.click();
  await page.getByRole("link", { name: "Ver el pago recurrente" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Luz" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Historial" })).toContainText("S/ 1,080.50");
});

test("skip a period, and undo it", async ({ page }) => {
  const id = await insertRecurring({ name: "Gimnasio" });
  await openPayments(page);
  await page.getByRole("button", { name: "Más acciones de Gimnasio" }).click();
  const sheet = page.getByRole("dialog", { name: "Registrar pago de Gimnasio" });
  await untilSaved(page, () => sheet.getByRole("button", { name: "Omitir este período" }).click());
  await expect(sheet).toBeHidden();
  await expect(page.getByText(/Nada pendiente/)).toBeVisible();
  await expect(financeNotices(page).getByText("Período omitido")).toBeVisible();
  await expect
    .poll(async () => (await readSettlements(id)).map((row) => row.status))
    .toEqual(["skipped"]);
  expect(await readRecurringExpenses(id)).toHaveLength(0);
  await expect(
    page.getByRole("list", { name: /^Este mes/ }).getByText("Omitido", { exact: true }),
  ).toBeVisible();
  await untilSaved(page, () =>
    financeNotices(page).getByRole("button", { name: "Deshacer" }).click(),
  );
  await expect(payKey(page, "Gimnasio")).toBeVisible();
  await expect.poll(async () => (await readSettlements(id)).length).toBe(0);
});

test("create a yearly payment; its page: archive, reactivate, delete and undo", async ({
  page,
}) => {
  await insertMethod("Débito de prueba");
  await openPayments(page);
  await page.getByRole("button", { name: "Nuevo pago recurrente" }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo pago recurrente" });
  await expect(sheet.getByRole("textbox", { name: "Nombre" })).toBeFocused();
  await page.keyboard.type("Seguro de prueba");
  await sheet.getByRole("combobox", { name: "Ciclo" }).selectOption("yearly");
  await sheet.getByRole("combobox", { name: "Día del mes" }).selectOption("23");
  await sheet.getByRole("combobox", { name: "Mes", exact: true }).selectOption("3");
  await sheet.getByRole("textbox", { name: "Monto previsto en soles" }).fill("1200");
  await sheet.getByRole("combobox", { name: "Medio de pago" }).selectOption({
    label: "Débito de prueba",
  });
  await untilSaved(page, () => sheet.getByRole("button", { name: "Guardar" }).click());
  await expect(sheet).toBeHidden();
  const stored = await readRecurring("Seguro de prueba");
  expect(stored).toMatchObject({
    cycle: "yearly",
    dayOfMonth: 23,
    anchorMonth: 3,
    amountCents: 120_000,
    weekday: null,
    intervalMonths: null,
  });
  const link = page.getByRole("list", { name: "Todos" }).getByRole("link", { name: /Seguro/ });
  await expect(link).toContainText("Anual, 23 mar");

  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: "Seguro de prueba" })).toBeVisible();
  await expect(page).toHaveTitle("Seguro de prueba · Finanzas · brahua-os");
  await expect(
    page.getByRole("list", { name: "Próximos vencimientos" }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(page.getByText("Todavía no hay períodos pagados ni omitidos.")).toBeVisible();

  await untilSaved(page, () => page.getByRole("button", { name: "Archivar" }).click());
  await expect(page.getByRole("button", { name: "Reactivar" })).toBeFocused();
  await expect
    .poll(async () => (await readRecurring("Seguro de prueba"))?.archivedAt)
    .not.toBeNull();
  await untilSaved(page, () => page.getByRole("button", { name: "Reactivar" }).click());
  await expect(page.getByRole("button", { name: "Archivar" })).toBeFocused();

  await page.getByRole("button", { name: "Eliminar" }).click();
  await expect(page).toHaveURL(/\/finance$/);
  await expect(financeNotices(page).getByText("Pago recurrente eliminado")).toBeVisible();
  await expect(page.getByRole("list", { name: "Todos" })).toHaveCount(0);
  await untilSaved(page, () =>
    financeNotices(page).getByRole("button", { name: "Deshacer" }).click(),
  );
  await expect(
    page.getByRole("list", { name: "Todos" }).getByRole("link", { name: /Seguro/ }),
  ).toBeVisible();
  expect((await readRecurring("Seguro de prueba"))?.deletedAt).toBeNull();
  // A deleted or unknown payment is a 404 inside the shell.
  await page.goto("/finance/payments/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "Este pago recurrente no existe" })).toBeVisible();
});

test("at 320 px nothing scrolls sideways (Pagos, Pagado…, the new payment sheet)", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const methodId = await insertMethod("Una tarjeta con un nombre bastante largo");
  const id = await insertRecurring({
    name: "Un pago recurrente con un nombre bastante largo para probar",
    amountCents: 99_999_999,
    paymentMethodId: methodId,
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await openPayments(page);
  const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await scrollWidth()).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: /^Más acciones de Un pago/ }).click();
  const pay = page.getByRole("dialog", { name: /^Registrar pago de Un pago/ });
  await expect(pay).toBeVisible();
  await animationsSettled(page);
  const payBody = pay.locator(".bo-sheet__body");
  expect(await payBody.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(pay).toBeHidden();
  await page.getByRole("button", { name: "Nuevo pago recurrente" }).click();
  const create = page.getByRole("dialog", { name: "Nuevo pago recurrente" });
  await create.getByRole("combobox", { name: "Ciclo" }).selectOption("every_n_months");
  await animationsSettled(page);
  const createBody = create.locator(".bo-sheet__body");
  expect(await createBody.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await scrollWidth()).toBeLessThanOrEqual(320);

  // The payment's page, and the 404 (with no accessibility violations).
  await page.keyboard.press("Escape");
  await openReady(page, `/finance/payments/${id}`);
  await expect(page.getByRole("list", { name: "Próximos vencimientos" })).toBeVisible();
  expect(await scrollWidth()).toBeLessThanOrEqual(320);
  await page.goto("/finance/payments/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "Este pago recurrente no existe" })).toBeVisible();
  expect(await scrollWidth()).toBeLessThanOrEqual(320);
  expect(await axeViolations(page)).toEqual([]);
});

/**
 * Every frame's transform of the sheet for ~300 ms from the click that opens it (the sampling
 * starts before the click, so the first frames of a slide are caught).
 */
async function sheetTransforms(page: Page, open: () => Promise<void>): Promise<string[]> {
  const sampling = page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const samples: string[] = [];
        const start = performance.now();
        const tick = () => {
          const sheet = document.querySelector('[role="dialog"]');
          if (sheet) samples.push(getComputedStyle(sheet).transform);
          if (performance.now() - start < 300) requestAnimationFrame(tick);
          else resolve(samples);
        };
        requestAnimationFrame(tick);
      }),
  );
  await open();
  return sampling;
}

const IDENTITY = /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/;

test("with reduced motion the Pagado… sheet opens without moving (positive control: it slides)", async ({
  page,
}) => {
  await insertRecurring({ name: "Luz", amountCents: null });
  // Positive control: without the preference some frame is mid-slide.
  await openPayments(page);
  const sliding = await sheetTransforms(page, () => payKey(page, "Luz").click());
  expect(sliding.length).toBeGreaterThan(0);
  expect(sliding.some((transform) => !IDENTITY.test(transform))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const still = await sheetTransforms(page, () => payKey(page, "Luz").click());
  await expect(
    page
      .getByRole("dialog", { name: "Registrar pago de Luz" })
      .getByRole("textbox", { name: "Monto pagado en soles" }),
  ).toBeFocused();
  expect(still.length).toBeGreaterThan(0);
  expect(still.filter((transform) => !IDENTITY.test(transform))).toEqual([]);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (Pagos, Pagado…, the sheet, the page)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const methodId = await insertMethod("Tarjeta de prueba");
    const id = await insertRecurring({ name: "Internet", paymentMethodId: methodId });
    // Never pending on any day the reference screenshot is compared (they start in 2030).
    await insertRecurring({
      name: "Luz",
      amountCents: null,
      dayOfMonth: 1,
      startDate: "2030-01-01",
    });
    await insertRecurring({
      name: "Seguro",
      cycle: "yearly",
      dayOfMonth: 23,
      anchorMonth: 3,
      startDate: "2030-01-01",
    });
    await insertRecurring({ name: "Antiguo", archived: true });
    await openReady(page, "/finance");
    await setTheme(page, theme);
    await page.getByRole("tab", { name: "Pagos" }).click();
    await page.getByText("Archivados (1)").click();
    expect(await axeViolations(page)).toEqual([]);
    await expectScreenshot(pendingList(page), `finance-payments-pending-${theme}.png`);

    await page.getByRole("button", { name: "Más acciones de Internet" }).click();
    await expect(page.getByRole("dialog", { name: "Registrar pago de Internet" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Nuevo pago recurrente" }).click();
    const create = page.getByRole("dialog", { name: "Nuevo pago recurrente" });
    await create.getByRole("button", { name: "Guardar" }).click();
    await expect(create.getByRole("textbox", { name: "Nombre" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");

    await untilSaved(page, () => payKey(page, "Internet").click());
    await openReady(page, `/finance/payments/${id}`);
    await expect(page.getByRole("list", { name: "Historial" })).toContainText("S/ 50.00");
    expect(await axeViolations(page)).toEqual([]);
  });
}
