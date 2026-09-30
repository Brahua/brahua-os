import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { clientIp, E2E_OWNER } from "./support/owner";

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
  await page.getByRole("button", { name: "Entrar" }).click();
}

for (const path of ["/", "/design"]) {
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
  await expect(page.getByRole("heading", { level: 1, name: "brahua-os" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "brahua-os" })).toBeVisible();

  // Already signed in: /login sends you back to the app.
  await page.goto("/login");
  await expect(page).toHaveURL("/");

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL("/login");
  await page.goto("/");
  await expect(page).toHaveURL("/login");
});

test("a wrong password is announced and focus returns to the password", async ({ page }) => {
  await page.goto("/login");
  await signIn(page, "not the right password");

  // Scoped to main: Next.js adds its own route announcer with role="alert".
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "El email o la contraseña no coinciden",
  );
  const password = page.getByLabel("Contraseña");
  await expect(password).toBeFocused();
  await expect(password).toHaveValue("");
  await expect(page).toHaveURL("/login");

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("empty fields show field errors without calling the server", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Entrar" }).click();

  const email = page.getByLabel("Email");
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Escribe tu contraseña.")).toBeVisible();
});

for (const theme of ["dark", "light"] as const) {
  test(`/login has no accessibility violations in the ${theme} theme`, async ({ page }) => {
    await page.goto("/login");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
