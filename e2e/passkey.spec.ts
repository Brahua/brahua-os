import AxeBuilder from "@axe-core/playwright";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { clientIp, E2E_OWNER } from "./support/owner";

// Signed out: every test starts from /login in a context of its own.
test.use({ storageState: { cookies: [], origins: [] } });

let requestCounter = 0;
test.beforeEach(async ({ page }, testInfo) => {
  // A client IP of its own per test (offset from login.spec.ts): rate limits never leak.
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": clientIp(testInfo.workerIndex, testInfo.retry, 128 + ++requestCounter),
  });
});

/** Chromium's virtual authenticator: a platform authenticator (Touch ID-like) that always says yes. */
async function addVirtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; id: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, id: authenticatorId };
}

async function signInWithPassword(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Contraseña").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL("/");
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

/** Password sign-in, then registers a passkey from the home page section. */
async function registerPasskey(page: Page, name: string) {
  await signInWithPassword(page);
  const section = page.getByRole("region", { name: /Passkeys/ });
  await section.getByLabel("Nombre (opcional)").fill(name);
  await section.getByRole("button", { name: "Registrar passkey" }).click();

  await expect(section.getByRole("status")).toHaveText(
    "Passkey registrada. Ya puedes entrar con ella.",
  );
  await expect(section.getByRole("list")).toContainText(name);
  return section;
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL("/login");
}

async function expectSignedIn(page: Page) {
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "brahua-os" })).toBeVisible();
  // A real session: reloading keeps you in.
  await page.reload();
  await expect(page).toHaveURL("/");
}

test("register a passkey after the password, sign out, and sign back in with the button", async ({
  page,
}, testInfo) => {
  // The virtual authenticator answers autofill (conditional) requests by itself, which would
  // sign in before the click. Hide autofill support so this test covers the button alone.
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = async () => false;
  });
  const authenticator = await addVirtualAuthenticator(page);
  const name = `Chromium ${testInfo.project.name} (botón)`;

  const section = await registerPasskey(page, name);
  await expect(section.getByRole("list")).toContainText(/Creada el \d+ de \w+ de \d{4}/);
  // One discoverable credential on the device, bound to this app's rpID.
  const { credentials } = await authenticator.cdp.send("WebAuthn.getCredentials", {
    authenticatorId: authenticator.id,
  });
  expect(credentials).toHaveLength(1);
  expect(credentials[0]).toMatchObject({ rpId: "localhost", isResidentCredential: true });

  // The new section passes axe in both themes.
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(section.getByRole("list")).toContainText(name);
    await expectNoAxeViolations(page);
  }

  await signOut(page);
  await page.getByRole("button", { name: "Entrar con passkey" }).click();
  await expectSignedIn(page);
});

test("autofill: /login offers the passkey in the background and signs in with it", async ({
  page,
}, testInfo) => {
  await addVirtualAuthenticator(page);
  await registerPasskey(page, `Chromium ${testInfo.project.name} (autocompletar)`);

  // Back on /login, the conditional request is answered by the virtual authenticator (a person
  // would pick the passkey from the Email field's list): no click needed.
  const verified = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/passkey/verify-authentication") &&
      response.status() === 200,
  );
  // Not waiting for the /login URL: the autofill sign-in can leave it before it is observed.
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await verified;
  await expectSignedIn(page);
});

test("with no passkey on this device, the prompt fails quietly and /login stays usable", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await page.goto("/login");

  // The click starts a new ceremony (the autofill request made on load is replaced).
  const ceremony = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/passkey/generate-authenticate-options"),
  );
  await page.getByRole("button", { name: "Entrar con passkey" }).click();
  expect((await ceremony).status()).toBe(200);

  // Back to idle: no alert, still on /login, the password form works.
  await expect(page.getByRole("button", { name: "Entrar con passkey" })).toBeEnabled();
  await expect(page.getByRole("main").getByRole("alert")).toBeEmpty();
  await expect(page).toHaveURL("/login");
  await expectNoAxeViolations(page);
});
