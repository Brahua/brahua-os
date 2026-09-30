import AxeBuilder from "@axe-core/playwright";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { clientIp, E2E_OWNER, HOME_HEADING } from "./support/owner";

// Signed out: every test starts from /login in a context of its own.
test.use({ storageState: { cookies: [], origins: [] } });

let requestCounter = 0;
test.beforeEach(async ({ page }, testInfo) => {
  // A client IP of its own per test (offset from login.spec.ts): rate limits never leak.
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": clientIp(testInfo.workerIndex, testInfo.retry, 128 + ++requestCounter),
  });
});

const THEMES = ["dark", "light"] as const;
type Theme = (typeof THEMES)[number];

/**
 * Chromium's virtual authenticator: a platform authenticator (Touch ID-like) with user
 * verification that always says yes. It also answers autofill (conditional) requests by itself.
 */
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

/** Hides autofill support, so the virtual authenticator cannot sign in before a click. */
async function disableAutofill(page: Page) {
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = async () => false;
  });
}

async function signInWithPassword(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Contraseña").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL("/");
}

function passkeySection(page: Page) {
  return page.getByRole("region", { name: /^Passkeys/ });
}

/** Password sign-in, then registers a passkey from Ajustes (/settings). */
async function registerPasskey(page: Page, name: string) {
  await signInWithPassword(page);
  await page.goto("/settings");
  const section = passkeySection(page);
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
  await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();
  // A real session: reloading keeps you in.
  await page.reload();
  await expect(page).toHaveURL("/");
}

async function setTheme(page: Page, theme: Theme) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

function countRequests(page: Page, path: string) {
  let count = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(`/api/auth${path}`)) count++;
  });
  return () => count;
}

test("register a passkey after the password, sign out, and sign back in with the button", async ({
  page,
}, testInfo) => {
  await disableAutofill(page);
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

  // The section, in both themes: listed, and failing (the same device registered twice).
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await expect(section.getByRole("list")).toContainText(name);
    await expectNoAxeViolations(page);
    await section.getByRole("button", { name: "Registrar passkey" }).click();
    await expect(section.getByRole("alert")).toContainText("Este dispositivo ya tiene una passkey");
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

test("autofill on: pressing the button right away is not undone by the late autofill request", async ({
  page,
}, testInfo) => {
  // Counts browser passkey prompts (navigator.credentials.get), autofill ones included.
  await page.addInitScript(() => {
    const counted = window as unknown as { passkeyPrompts: number };
    counted.passkeyPrompts = 0;
    const get = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = (options) => {
      counted.passkeyPrompts++;
      return get(options);
    };
  });
  const prompts = () =>
    page.evaluate(() => (window as unknown as { passkeyPrompts: number }).passkeyPrompts);
  await addVirtualAuthenticator(page);
  await registerPasskey(page, `Chromium ${testInfo.project.name} (carrera)`);

  // Hold the autofill request's options on /login, so the button starts first and the autofill
  // attempt only gets its options afterwards: exactly the race that used to abort the prompt.
  let autofillAsked: () => void = () => {};
  let autofillAnswered: () => void = () => {};
  const autofillRequested = new Promise<void>((resolve) => (autofillAsked = resolve));
  const autofillDone = new Promise<void>((resolve) => (autofillAnswered = resolve));
  let first = true;
  await page.route("**/api/auth/passkey/generate-authenticate-options", async (route) => {
    if (!first) return route.continue();
    first = false;
    autofillAsked();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
    autofillAnswered();
  });
  const verifications = countRequests(page, "/passkey/verify-authentication");

  await signOut(page);
  await autofillRequested;
  const before = await prompts();
  await page.getByRole("button", { name: "Entrar con passkey" }).click();
  await expect(page).toHaveURL("/");
  await autofillDone;
  await page.waitForTimeout(300);

  // One prompt (the button's) and one verification: the outdated autofill attempt got its
  // options late and never opened a prompt, which would have aborted the button's.
  expect((await prompts()) - before).toBe(1);
  expect(verifications()).toBe(1);
  await expectSignedIn(page);
});

test("delete a passkey: it no longer signs in, and the failure is announced", async ({
  page,
}, testInfo) => {
  await disableAutofill(page);
  await addVirtualAuthenticator(page);
  const name = `Chromium ${testInfo.project.name} (eliminar)`;
  const section = await registerPasskey(page, name);

  const remove = section.getByRole("button", { name: `Eliminar ${name}` });
  await remove.click();
  await expect(section.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await expectNoAxeViolations(page);
  await section.getByRole("button", { name: "Sí, eliminar" }).click();

  await expect(section.getByRole("status")).toHaveText("Passkey eliminada.");
  await expect(section.getByRole("heading", { level: 2 })).toBeFocused();
  await expect(section.getByText(name)).toHaveCount(0);

  // The browser still offers the deleted passkey; the server refuses it.
  await signOut(page);
  const button = page.getByRole("button", { name: "Entrar con passkey" });
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await button.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "No se pudo entrar con esa passkey",
    );
    await expect(button).toHaveAccessibleDescription(/No se pudo entrar con esa passkey/);
    await expect(page).toHaveURL("/login");
    await expectNoAxeViolations(page);
  }
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
  await expect(page.getByRole("button", { name: "Entrar con passkey" })).toHaveAttribute(
    "aria-disabled",
    "false",
  );
  await expect(page.getByRole("main").getByRole("alert")).toBeEmpty();
  await expect(page).toHaveURL("/login");
  await expectNoAxeViolations(page);
});

test("a browser without passkeys: disabled but reachable keys that say why, axe at 0", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;
  });

  await page.goto("/login");
  const signInKey = page.getByRole("button", { name: "Entrar con passkey" });
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await expect(signInKey).toHaveAttribute("aria-disabled", "true");
    await expect(signInKey).toHaveAccessibleDescription(/no admite passkeys/);
    await expectNoAxeViolations(page);
  }
  await signInKey.focus();
  await expect(signInKey).toBeFocused();

  await signInWithPassword(page);
  await page.goto("/settings");
  const registerKey = passkeySection(page).getByRole("button", { name: "Registrar passkey" });
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await expect(registerKey).toHaveAttribute("aria-disabled", "true");
    await expect(registerKey).toHaveAccessibleDescription(/no admite passkeys/);
    await expectNoAxeViolations(page);
  }
});
