import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { clientIp, E2E_OWNER, HOME_HEADING } from "./support/owner";
import { expectScreenshot } from "./support/screenshots";

// Signed out: these specs start without the owner session.
test.use({ storageState: { cookies: [], origins: [] } });

let requestCounter = 0;
test.beforeEach(async ({ page }, testInfo) => {
  // A client IP of its own per test: the sign-in rate limit (5/min per IP) never leaks between tests.
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": clientIp(testInfo.workerIndex, testInfo.retry, ++requestCounter),
  });
});

async function signIn(page: Page, password: string) {
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

for (const path of ["/", "/design", "/settings"]) {
  test(`without a session ${path} redirects to /login`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Iniciar sesión" })).toBeVisible();
  });
}

test("login with the password lands in the app, survives a reload and signs out", async ({
  page,
}) => {
  await page.goto("/login");
  await signIn(page, E2E_OWNER.password);

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();
  // Each app load asks the auth handler for the session, which is what renews the cookie.
  const renewal = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/get-session") && response.status() === 200,
  );
  await page.reload();
  await renewal;
  await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();

  // Already signed in: /login sends you back to the app.
  await page.goto("/login");
  await expect(page).toHaveURL("/");

  // "Cerrar sesión" lives in Ajustes.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL("/login");
  await page.goto("/");
  await expect(page).toHaveURL("/login");
});

async function openLogin(page: Page, theme: "dark" | "light") {
  await page.goto("/login");
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`${theme} theme`, () => {
    test("/login has no accessibility violations and matches the reference screenshot", async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openLogin(page, theme);
      await expectNoAxeViolations(page);
      await fontsLoaded(page);
      await expectScreenshot(page.getByRole("main"), `login-${theme}.png`);
    });

    test("a wrong password is announced, focus returns to the password, axe stays at 0", async ({
      page,
    }) => {
      await openLogin(page, theme);
      await signIn(page, "not the right password");

      // Scoped to main: Next.js adds its own route announcer with role="alert".
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "El email o la contraseña no coinciden",
      );
      const password = page.getByLabel("Contraseña");
      await expect(password).toBeFocused();
      await expect(password).toHaveValue("");
      await expect(password).toHaveAccessibleDescription(/no coinciden/);
      await expect(page).toHaveURL("/login");
      await expectNoAxeViolations(page);
    });

    test("empty fields show field errors without calling the server, axe stays at 0", async ({
      page,
    }) => {
      await openLogin(page, theme);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();

      const email = page.getByLabel("Email");
      await expect(email).toBeFocused();
      await expect(email).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByText("Escribe tu contraseña.")).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}

test("every response carries the security headers", async ({ request }) => {
  for (const path of ["/login", "/", "/api/auth/ok"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    expect(headers["content-security-policy"], path).toBe("frame-ancestors 'none'");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
  }
});
