import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { animationsSettled } from "./support/animations";
import {
  insertMethod,
  insertRecurring,
  readRecurringExpenses,
  readSettlements,
} from "./support/finance";
import { fontsLoaded } from "./support/fonts";
import { expect, insertHabit } from "./support/habits";
import { expectNoOverflow, isDesktop, limaDay, notices, untilSaved } from "./support/projects";
import { afterSaveSettled } from "./support/saves";
import { expectScreenshot } from "./support/screenshots";
import { boardTest as test } from "./support/today-tasks";

// F4 of `finance` on "/" (SPEC-finance "Con `today`"): "Pagos" between Tareas and Proyectos, pay
// with one tap and undo, a variable amount through "Pagado…", "Día completo" kept away by an
// overdue payment (never by an upcoming one), 320 px, reduced motion and accessibility.
//
// Every test is a `boardTest` (e2e/support/today-tasks.ts): the habits, tasks and finance locks,
// no habits, no tasks due or done today and empty finance tables, so "Pagos" only shows the
// test's payments (the fixed projects of global-setup may show below). Made-up names and amounts.

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
const row = (page: Page, name: string) =>
  rows(page)
    .locator("li")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
const payKey = (page: Page, name: string) =>
  section(page).getByRole("button", { name: new RegExp(`^Pagado(, con monto)?: ${name},`) });
const complete = (page: Page) => page.getByRole("region", { name: "Día completo" });

/** A monthly payment due exactly `days` from Lima's today (negative: overdue), from that day. */
function dueIn(days: number, values: Parameters<typeof insertRecurring>[0]) {
  const day = limaDay(days);
  return insertRecurring({ dayOfMonth: Number(day.slice(8, 10)), startDate: day, ...values });
}

test("pay from Hoy with one tap and undo it; the section sits between Tareas and Proyectos", async ({
  page,
}) => {
  const methodId = await insertMethod("Tarjeta de prueba");
  const internet = await insertRecurring({ name: "Internet", paymentMethodId: methodId });
  await dueIn(-3, { name: "Agua" });
  await openToday(page);

  // After Tareas (none today) and before the fixed projects.
  const order = await page
    .locator("[data-today-board] > section[data-today-section]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-today-section")));
  expect(order.indexOf("payments")).toBe(order.indexOf("projects") - 1);
  // Overdue first, by date.
  await expect(rows(page).locator("li")).toHaveCount(2);
  await expect(row(page, "Agua")).toContainText("Venció hace 3 días");
  await expect(row(page, "Internet")).toContainText("Vence hoy");
  await expect(row(page, "Internet")).toContainText("S/ 50.00");
  await expect(
    rows(page).getByRole("link", { name: "Internet", exact: true }),
  ).toHaveAccessibleDescription("Vence hoy, 50 soles, Tarjeta de prueba");

  await untilSaved(page, () => payKey(page, "Internet").click());
  await expect(row(page, "Internet")).toHaveCount(0);
  await expect(payKey(page, "Agua")).toBeFocused();
  await expect(notices(page).getByText("Internet · 50 soles")).toBeVisible();
  await expect.poll(async () => (await readSettlements(internet)).length).toBe(1);
  const [expense] = await readRecurringExpenses(internet);
  expect(expense).toMatchObject({ amountCents: 5_000, paymentMethodId: methodId });

  await untilSaved(page, () => notices(page).getByRole("button", { name: "Deshacer" }).click());
  await expect(row(page, "Internet")).toBeVisible();
  await expect.poll(async () => (await readSettlements(internet)).length).toBe(0);
  await expect
    .poll(async () => (await readRecurringExpenses(internet)).every((row) => row.deletedAt))
    .toBe(true);
  // The server agrees after a reload.
  await openToday(page);
  await expect(row(page, "Internet")).toContainText("Vence hoy");
});

test("a variable amount from Hoy: Pagado… asks for it, and the row leaves", async ({ page }) => {
  const luz = await insertRecurring({ name: "Luz", amountCents: null });
  await openToday(page);
  await expect(row(page, "Luz")).toContainText("Monto variable");
  await payKey(page, "Luz").click();
  const sheet = page.getByRole("dialog", { name: "Registrar pago de Luz" });
  const amount = sheet.getByRole("textbox", { name: "Monto pagado en soles" });
  await expect(amount).toBeFocused();
  // The home page only pays.
  await expect(sheet.getByRole("button", { name: /Omitir/ })).toHaveCount(0);
  await amount.fill("85,40");
  await untilSaved(page, () => amount.press("Enter"));
  await expect(sheet).toBeHidden();
  await expect(section(page)).toHaveCount(0);
  // The last row: focus on the board's heading, never <body>.
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(notices(page).getByText("Luz · 85.40 soles")).toBeVisible();
  await expect
    .poll(async () => (await readRecurringExpenses(luz)).map((row) => row.amountCents))
    .toEqual([8_540]);
});

test("an overdue payment keeps Día completo away; paid, it shows; an upcoming one never counts", async ({
  page,
}) => {
  await insertHabit({ name: "Leer", done: true, sortOrder: 0 });
  await dueIn(-2, { name: "Agua" });
  await dueIn(3, { name: "Gimnasio" });
  await openToday(page);
  await expect(row(page, "Agua")).toBeVisible();
  await expect(complete(page)).toHaveCount(0);

  await untilSaved(page, () => payKey(page, "Agua").click());
  await expect(complete(page)).toBeVisible();
  // The upcoming one stays on the board next to Día completo.
  await expect(row(page, "Gimnasio")).toBeVisible();
  await afterSaveSettled(page);
  await openToday(page);
  await expect(complete(page)).toBeVisible();
  await expect(row(page, "Gimnasio")).toBeVisible();
});

test("four payments: the urgent ones first, 3 shown and Ver 1 más; the signal key only when urgent", async ({
  page,
}) => {
  await dueIn(3, { name: "Gimnasio" });
  await dueIn(-1, { name: "Agua" });
  await insertRecurring({ name: "Internet" });
  await dueIn(5, { name: "Seguro" });
  await openToday(page);
  const names = () => rows(page).locator("li a").allTextContents();
  await expect(rows(page).locator("li")).toHaveCount(3);
  expect(await names()).toEqual(["Agua", "Internet", "Gimnasio"]);
  await expect(payKey(page, "Agua")).toHaveClass(/bo-key--signal/);
  await expect(payKey(page, "Gimnasio")).toHaveClass(/bo-key--ghost/);
  const more = section(page).getByRole("button", { name: "Ver 1 más" });
  await more.click();
  await expect(rows(page).locator("li")).toHaveCount(4);
  await expect(section(page).getByRole("button", { name: "Ver menos" })).toBeFocused();
});

test("at 320 px the section doesn't scroll sideways @responsive", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  const methodId = await insertMethod("Una tarjeta con un nombre bastante largo");
  await insertRecurring({
    name: "Un pago recurrente con un nombre bastante largo para probar",
    amountCents: 99_999_999,
    paymentMethodId: methodId,
  });
  await insertRecurring({ name: "Electroencefalografistas", amountCents: null });
  await page.setViewportSize({ width: 320, height: 640 });
  await openToday(page);
  await expect(rows(page).locator("li")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const item of await rows(page).locator("li").all()) {
    await expectNoOverflow(page, item);
  }
});

test("with reduced motion the Pagado… sheet opens in place on Hoy", async ({ page }) => {
  await insertRecurring({ name: "Luz", amountCents: null });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openToday(page);
  const transforms = page.evaluate(
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
  await payKey(page, "Luz").click();
  const still = await transforms;
  expect(still.length).toBeGreaterThan(0);
  expect(still.filter((value) => !/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(value))).toEqual([]);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations (Pagos, Pagado…, the notice); the section (reference screenshot) @responsive`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const methodId = await insertMethod("Tarjeta de prueba");
    // Labels that read the same every day: due today and 2 days ago.
    await insertRecurring({ name: "Internet", paymentMethodId: methodId });
    await insertRecurring({ name: "Luz", amountCents: null });
    await dueIn(-2, { name: "Agua", amountCents: 3_990 });
    await openToday(page);
    await setTheme(page, theme);
    await expect(rows(page).locator("li")).toHaveCount(3);
    expect(await axeViolations(page)).toEqual([]);
    await expectScreenshot(section(page), `today-payments-${theme}.png`);

    await payKey(page, "Luz").click();
    await expect(page.getByRole("dialog", { name: "Registrar pago de Luz" })).toBeVisible();
    await animationsSettled(page);
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await untilSaved(page, () => payKey(page, "Internet").click());
    await expect(notices(page).getByText("Pago registrado")).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
}
