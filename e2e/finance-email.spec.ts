import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { animationsSettled } from "./support/animations";
import { E2E_FINANCE_EMAIL_SECRET } from "./support/finance-email-env";
import {
  expect,
  financeNotices,
  insertMethod,
  openReady,
  readAllExpenses,
  readSuggestions,
  test,
} from "./support/finance";
import { fontsLoaded } from "./support/fonts";
import { isDesktop, limaDay } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";

// finance-email: a batch posted to the ingest endpoint as the owner's Apps Script would, the inbox of
// /finance («Sugerencias»), «Registrar» with one touch and its «Deshacer», the card digits that pick
// the method (set in Ajustes), and accessibility in both themes and at 320 px. Every test holds the
// finance lock (shared data). Made-up merchants, names and amounts only.

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

/** `YYYY-MM-DD` → `DD/MM/YYYY`, the way BBVA writes the day. */
const bbvaDay = (day: string) => day.split("-").reverse().join("/");

const bbvaPurchase = (id: string, merchant: string, amount: string, day: string) => ({
  id,
  from: "procesos@bbva.com.pe",
  subject: "Has realizado un consumo con tu tarjeta BBVA",
  receivedAt: new Date().toISOString(),
  text: `| Comercio: ${merchant} | |\n| Monto: ${amount} | Moneda: PEN |\n| Fecha: ${bbvaDay(day)} | Hora: 14:52:43 |\n| Este se cargará a tu tarjeta terminada en *1234 |`,
  auth: "pass",
});

/** What the Apps Script sends: a Bearer secret and the batch. */
async function ingest(page: Page, messages: object[]) {
  const response = await page.request.post("/api/finance/email-ingest", {
    headers: { authorization: `Bearer ${E2E_FINANCE_EMAIL_SECRET}` },
    data: { messages },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

const row = (page: Page, text: string) =>
  page.locator("[data-suggestion]").filter({ hasText: text });

test("a posted batch becomes suggestions; Registrar makes the expense with the method of its card, Deshacer takes it back", async ({
  page,
}) => {
  const today = limaDay(0);
  const methodId = await insertMethod("BBVA crédito");
  await openReady(page, "/finance");

  // The digits of the card, in Ajustes, are what picks the method.
  await page.getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("dialog", { name: "Ajustes de Finanzas" });
  await settings.getByRole("textbox", { name: "Últimos 4 dígitos de BBVA crédito" }).fill("1234");
  await settings.getByRole("button", { name: "Guardar dígitos" }).click();
  await expect(settings.locator("[data-email-settings-status]")).toHaveText(
    "Dígitos de BBVA crédito guardados.",
  );
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // The batch: a purchase, a second one, an email nobody reads, and one that is not an expense.
  const batch = [
    bbvaPurchase("e2e00000000000a1", "TIENDA DEMO", "43.20", today),
    bbvaPurchase("e2e00000000000a2", "CAFE DEMO", "12.50", today),
    { ...bbvaPurchase("e2e00000000000a3", "x", "1", today), from: "promo@else.test" },
    {
      ...bbvaPurchase("e2e00000000000a4", "x", "1", today),
      subject: "BBVA - Constancia Pago de Tarjetas propias",
    },
  ];
  expect(await ingest(page, batch)).toMatchObject({ created: 2, unknown: 1, ignored: 1 });
  // The same batch again changes nothing (the script may run twice).
  expect(await ingest(page, batch)).toMatchObject({ created: 0, duplicates: 2 });
  expect(await readSuggestions()).toHaveLength(2);

  await openReady(page, "/finance");
  const inbox = page.getByRole("region", { name: /Sugerencias/ });
  await expect(inbox.getByRole("heading", { level: 2 })).toContainText("2 sugerencias");
  await expect(row(page, "TIENDA DEMO")).toContainText("S/ 43.20");
  await expect(row(page, "TIENDA DEMO")).toContainText("BBVA crédito");

  // One touch: the row leaves, a notice says so, the expense exists with the method of its card.
  await row(page, "TIENDA DEMO").getByRole("button", { name: "Registrar" }).click();
  await expect(financeNotices(page)).toContainText("Gasto registrado");
  await expect(row(page, "TIENDA DEMO")).toHaveCount(0);
  await expect(row(page, "CAFE DEMO").getByRole("button", { name: "Registrar" })).toBeFocused();
  await expect.poll(async () => (await readAllExpenses()).length).toBe(1);
  expect((await readAllExpenses())[0]).toMatchObject({
    description: "TIENDA DEMO",
    amountCents: 4320,
    currency: "PEN",
    spentOn: today,
    paymentMethodId: methodId,
  });
  await page.getByRole("tab", { name: "Gastos" }).click();
  await expect(page.getByRole("button", { name: /^Editar TIENDA DEMO/ })).toBeVisible();

  // Deshacer: the expense goes and the suggestion is back in the inbox.
  await financeNotices(page).getByRole("button", { name: "Deshacer" }).click();
  await expect(row(page, "TIENDA DEMO")).toBeVisible();
  await expect.poll(async () => (await readAllExpenses())[0]?.deletedAt != null).toBe(true);
  expect((await readSuggestions()).find((s) => s.merchant === "TIENDA DEMO")).toMatchObject({
    status: "pending",
    expenseId: null,
  });
});

for (const theme of THEMES) {
  test(`${theme} theme: the inbox and its sheet have no accessibility violations; at 320 px nothing scrolls sideways @responsive`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const today = limaDay(0);
    await ingest(page, [
      bbvaPurchase("e2e00000000000b1", "TIENDA DEMO", "43.20", today),
      {
        ...bbvaPurchase("e2e00000000000b2", "OTRA TIENDA", "10.00", today),
        auth: "none",
      },
      {
        id: "e2e00000000000b3",
        from: "procesos@bbva.com.pe",
        subject: "Constancia de operación transferencia PLIN",
        receivedAt: new Date().toISOString(),
        text: "nothing a rule knows",
        auth: "pass",
      },
    ]);
    await openReady(page, "/finance");
    await setTheme(page, theme);
    const inbox = page.getByRole("region", { name: /Sugerencias/ });
    await expect(inbox).toBeVisible();
    await expect(row(page, "No pude leerlo")).toBeVisible();
    await expect(row(page, "OTRA TIENDA")).toContainText("Remitente no verificado");
    expect(await axeViolations(page)).toEqual([]);
    await expectScreenshot(inbox, `finance-email-inbox-${theme}.png`);

    await row(page, "TIENDA DEMO").getByRole("button", { name: "Editar" }).click();
    const sheet = page.getByRole("dialog", { name: "Registrar sugerencia" });
    await expect(sheet.getByRole("textbox", { name: /^Monto en/ })).toHaveValue("43.20");
    await animationsSettled(page);
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    if (!isDesktop(testInfo)) {
      await page.setViewportSize({ width: 320, height: 640 });
      await openReady(page, "/finance");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
    }
  });
}
