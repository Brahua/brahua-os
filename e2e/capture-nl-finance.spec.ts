import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import {
  amountField,
  captureKey,
  expect,
  expenseSheet,
  expenseStatus,
  insertMethod,
  openReady,
  readExpenses,
  test,
} from "./support/finance";
import { fontsLoaded } from "./support/fonts";
import { isDesktop } from "./support/projects";
import { afterSaveSettled } from "./support/saves";

// polish → capture-nl-dates: the Gasto capture reads "12.50 café" (an amount and a description)
// and shows it under the fields; a touch cancels it. Every test holds the finance lock.

const THEMES = ["dark", "light"] as const;

/** A word no other test (or retry) uses, letters only (digits could read as an amount). */
const unique = (prefix: string, testInfo: TestInfo) =>
  `${prefix}${testInfo.project.name}${Math.random().toString(36).slice(2, 8).replace(/\d/g, "q")}`;

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

/** The device already remembers "Gasto" (the capture opens it straight away). */
async function rememberGasto(page: Page) {
  await page.addInitScript(() => localStorage.setItem("bo_capture_kind", "finance"));
}

const descriptionField = (page: Page) =>
  expenseSheet(page).getByRole("textbox", { name: "Descripción (opcional)" });
const preview = (page: Page) => expenseSheet(page).locator("[data-nl-preview]");

test("'12.50 café' typed in the amount field saves 1250 cents with the description 'café'", async ({
  page,
}, testInfo) => {
  // Letters need a hardware keyboard: the phone's decimal pad has none (it uses the description).
  test.skip(!isDesktop(testInfo), "Typed in the amount field with a keyboard");
  const word = unique("cafe", testInfo);
  await insertMethod("Efectivo", "PEN", true);
  await rememberGasto(page);
  await openReady(page, "/projects");

  const started = Date.now();
  await captureKey(page).click(); // 1
  await expect(amountField(page)).toBeFocused();
  await page.keyboard.type(`12.50 ${word}`); // 2
  await expect(preview(page)).toContainText("12.50");
  await expect(preview(page)).toContainText(word);
  await page.keyboard.press("Enter"); // 3
  await expect(expenseStatus(page)).toContainText("Registrado: 12.50 soles");
  expect(Date.now() - started).toBeLessThan(10_000);

  const [saved] = await readExpenses(word);
  expect(saved).toMatchObject({ amountCents: 1250, currency: "PEN", description: word });
  // Ready for the next one.
  await expect(amountField(page)).toHaveValue("");
  await expect(preview(page)).toHaveCount(0);
});

test("phone: '12.50 café' typed in the description (the pad has no letters) saves the same @responsive", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "The orange key of the bottom bar");
  const word = unique("cafe", testInfo);
  await insertMethod("Efectivo", "PEN", true);
  await rememberGasto(page);
  await openReady(page, "/projects");

  await captureKey(page).click();
  await expect(amountField(page)).toBeFocused();
  await descriptionField(page).fill(`12.50 ${word}`);
  await expect(preview(page)).toContainText("12.50");
  await descriptionField(page).press("Enter");
  await expect(expenseStatus(page)).toContainText("Registrado: 12.50 soles");

  const [saved] = await readExpenses(word);
  expect(saved).toMatchObject({ amountCents: 1250, currency: "PEN", description: word });
});

test("a currency in the text wins over the method's: 'USD 95 claude' saves 9500 cents in USD", async ({
  page,
}, testInfo) => {
  const word = unique("claude", testInfo);
  await insertMethod("Efectivo", "PEN", true);
  await rememberGasto(page);
  await openReady(page, "/projects");
  await captureKey(page).click();
  await expect(amountField(page)).toBeFocused();
  await descriptionField(page).fill(`USD 95 ${word}`);
  await expect(preview(page)).toContainText("95.00");
  await descriptionField(page).press("Enter");
  await expect(expenseStatus(page)).toContainText("Registrado");

  const [saved] = await readExpenses(word);
  expect(saved).toMatchObject({ amountCents: 9500, currency: "USD", description: word });
});

test("a touch on the preview cancels it; a description with no amount is unchanged", async ({
  page,
}, testInfo) => {
  const word = unique("mercado", testInfo);
  await insertMethod("Efectivo", "PEN", true);
  await rememberGasto(page);
  await openReady(page, "/projects");
  await captureKey(page).click();
  await expect(amountField(page)).toBeFocused();

  // Positive control: a description with no number shows no preview.
  await descriptionField(page).fill(word);
  await expect(preview(page)).toHaveCount(0);

  await descriptionField(page).fill(`12.50 ${word}`);
  await expect(preview(page)).toBeVisible();
  await preview(page).click();
  await expect(preview(page)).toHaveCount(0);
  await expect(descriptionField(page)).toBeFocused();
  await expect(descriptionField(page)).toHaveValue(`12.50 ${word}`);

  // With the amount typed by hand, it saves the description as typed.
  await amountField(page).fill("7");
  await amountField(page).press("Enter");
  await expect(expenseStatus(page)).toContainText("Registrado: 7 soles");
  const [saved] = await readExpenses(`12.50 ${word}`);
  expect(saved).toMatchObject({ amountCents: 700, description: `12.50 ${word}` });
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations with the preview showing`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await insertMethod("Efectivo", "PEN", true);
    await rememberGasto(page);
    await openReady(page, "/projects");
    await setTheme(page, theme);
    await captureKey(page).click();
    await expect(amountField(page)).toBeFocused();
    await descriptionField(page).fill("12.50 café");
    await expect(preview(page)).toBeVisible();
    await expect(expenseSheet(page).locator("[data-nl-status]")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(await axeViolations(page)).toEqual([]);
  });
}

test("at 320 px the preview doesn't scroll sideways @responsive", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await insertMethod("Efectivo", "PEN", true);
  await rememberGasto(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await openReady(page, "/projects");
  await captureKey(page).click();
  await expect(amountField(page)).toBeFocused();
  await descriptionField(page).fill("12.50 un almuerzo con un nombre bastante largo");
  await expect(preview(page)).toBeVisible();
  const box = await preview(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
