import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_ERROR_COOKIE, E2E_ERROR_MESSAGE } from "../src/lib/e2e-error-routes";
import { fontsLoaded } from "./support/fonts";
import { HOME_HEADING } from "./support/owner";
import { expectScreenshot } from "./support/screenshots";

// C8. The routes that force errors only exist in E2E builds (playwright.config.ts sets
// E2E_ERROR_ROUTES): /e2e/error throws inside the shell while its cookie is set, and
// /e2e/root-error always throws outside it.

const THEMES = ["dark", "light"] as const;
type Theme = (typeof THEMES)[number];

const NOT_FOUND_TITLE = "Página no encontrada · brahua-os";
const ERROR_TITLE = "Algo no salió bien · brahua-os";
const notFoundHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Nada por aquí" });
const errorHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Algo no salió bien" });
/** The shell's navigation (sidebar on desktop, bottom bar on phones). */
const appNavigation = (page: Page) => page.getByRole("navigation", { name: /Principal|Más/ });

async function forceAppError(context: BrowserContext, baseURL: string | undefined) {
  await context.addCookies([{ name: E2E_ERROR_COOKIE, value: "1", url: baseURL }]);
}

async function applyTheme(page: Page, theme: Theme) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

/** Neither the thrown message nor a stack frame ever reaches the browser. */
async function expectNoTechnicalDetails(page: Page, html?: string) {
  for (const source of [html ?? "", await page.content()]) {
    expect(source).not.toContain(E2E_ERROR_MESSAGE);
    expect(source).not.toMatch(/\bat \w+ \(|page\.e2e\.tsx|node_modules/);
  }
}

test("a missing route answers 404 with the app's page, inside the shell", async ({ page }) => {
  const response = await page.goto("/no-existe");

  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle(NOT_FOUND_TITLE);
  await expect(notFoundHeading(page)).toBeVisible();
  await expect(page.getByText("No encontramos esta página.")).toBeVisible();
  await expect(appNavigation(page).first()).toBeVisible();

  await page.getByRole("link", { name: "Volver a Hoy" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a missing route answers 404 and points to the login, without the shell", async ({
    page,
  }) => {
    const response = await page.goto("/no-existe");

    expect(response?.status()).toBe(404);
    await expect(notFoundHeading(page)).toBeVisible();
    await expect(appNavigation(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Volver a Hoy" })).toHaveCount(0);

    for (const theme of THEMES) {
      await applyTheme(page, theme);
      await expect(notFoundHeading(page)).toBeVisible();
      await expectNoAxeViolations(page);
    }

    await page.getByRole("link", { name: "Ir a iniciar sesión" }).click();
    await expect(page).toHaveURL("/login");
  });

  test("an error outside the shell shows the root error page without details", async ({ page }) => {
    const response = await page.goto("/e2e/root-error");

    expect(response?.status()).toBe(500);
    await expect(errorHeading(page)).toBeFocused();
    await expect(page).toHaveTitle(ERROR_TITLE);
    await expect(appNavigation(page)).toHaveCount(0);
    await expectNoTechnicalDetails(page, await response?.text());

    for (const theme of THEMES) {
      await applyTheme(page, theme);
      await expect(errorHeading(page)).toBeVisible();
      await expectNoAxeViolations(page);
    }
  });
});

test("an error in a signed-in page shows the error page in the shell, and Reintentar recovers", async ({
  page,
  context,
  baseURL,
}) => {
  const consoleText: string[] = [];
  page.on("console", (message) => consoleText.push(message.text()));
  await forceAppError(context, baseURL);

  const response = await page.goto("/e2e/error");

  await expect(errorHeading(page)).toBeVisible();
  // The heading takes the focus, so keyboard and screen reader users start at the explanation.
  await expect(errorHeading(page)).toBeFocused();
  await expect(page).toHaveTitle(ERROR_TITLE);
  await expect(page.getByText("No pudimos mostrar esta pantalla.")).toBeVisible();
  await expect(page.getByText(/^Código del error: \S+$/)).toBeVisible();
  await expect(appNavigation(page).first()).toBeVisible();
  await expectNoTechnicalDetails(page, await response?.text());
  expect(consoleText.join("\n")).not.toContain(E2E_ERROR_MESSAGE);

  // Still failing: Reintentar shows the error page again.
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(errorHeading(page)).toBeVisible();

  // The cause is gone: Reintentar re-renders the page without a full load.
  await context.clearCookies({ name: E2E_ERROR_COOKIE });
  await page.evaluate(
    () => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true),
  );
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Todo en orden" })).toBeVisible();
  await expect(errorHeading(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument),
  ).toBe(true);
});

test("Volver a Hoy leaves the error page with a full load", async ({ page, context, baseURL }) => {
  await forceAppError(context, baseURL);
  await page.goto("/e2e/error");
  await page.getByRole("link", { name: "Volver a Hoy" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();
});

// The app's fixed bottom bar would cover the end of the page on phones.
const HIDE_APP_NAV = path.join(__dirname, "support/hide-app-nav.css");

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations and the reference screenshots`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/no-existe");
    await applyTheme(page, theme);
    await expect(notFoundHeading(page)).toBeVisible();
    await fontsLoaded(page);
    await expectNoAxeViolations(page);
    await expectScreenshot(page.getByRole("main"), `not-found-${theme}.png`, {
      stylePath: HIDE_APP_NAV,
    });

    await forceAppError(context, baseURL);
    await page.goto("/e2e/error");
    await expect(errorHeading(page)).toBeFocused();
    await fontsLoaded(page);
    await expectNoAxeViolations(page);
    // The error code changes with every build, so it is masked.
    await expectScreenshot(page.getByRole("main"), `error-${theme}.png`, {
      stylePath: HIDE_APP_NAV,
      mask: [page.getByText(/^Código del error:/)],
    });
  });
}
