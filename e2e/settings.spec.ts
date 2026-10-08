import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import path from "node:path";
import { fontsLoaded } from "./support/fonts";
import { expectScreenshot } from "./support/screenshots";
import { HOME_HEADING } from "./support/owner";

// Signed in (the shared owner session). Signing out here would end that session for every other
// spec, so "Cerrar sesión" is covered in login.spec.ts and passkey.spec.ts, with sessions of
// their own.

const THEMES = ["dark", "light"] as const;
const isDesktop = (testInfo: TestInfo) => testInfo.project.name === "desktop";
const sidebar = (page: Page) => page.getByRole("banner");
const themeGroup = (page: Page) => page.getByRole("radiogroup", { name: "Apariencia" });
const shortcutsSwitch = (page: Page) => page.getByRole("switch", { name: "Atajos de teclado" });

/**
 * Records every value `data-theme` takes on <html> from the very start of each load, so a reload
 * that first painted another theme (a flash) would show up as an extra value.
 */
async function recordThemeChanges(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __themes: string[] }).__themes = seen;
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const value = (mutation.target as Element).getAttribute("data-theme");
        if (value) seen.push(value);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-theme"] });
  });
}

const themeChanges = (page: Page) =>
  page.evaluate(() => (window as unknown as { __themes: string[] }).__themes);

/** Records whether a handler called preventDefault() on each keydown (see home.spec.ts). */
async function recordKeys(page: Page) {
  await page.evaluate(() => {
    const log: { key: string; prevented: boolean }[] = [];
    (window as unknown as { __keys: typeof log }).__keys = log;
    window.addEventListener("keydown", (event) =>
      log.push({ key: event.key, prevented: event.defaultPrevented }),
    );
  });
}

const recordedKeys = (page: Page) =>
  page.evaluate(() => (window as unknown as { __keys: unknown[] }).__keys);

test("Ajustes has its title and sections, and is current in the navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/settings");

  await expect(page).toHaveTitle("Ajustes · brahua-os");
  await expect(page.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
  for (const name of ["Apariencia", "Teclado", /^Passkeys/, "Sesión"]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  if (isDesktop(testInfo)) {
    await expect(page.getByRole("link", { name: "Ajustes" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  } else {
    // On the phone Ajustes lives under "Más" (6 sections since Hábitos).
    await expect(page.getByRole("button", { name: "Más (actual: Ajustes)" })).toHaveAttribute(
      "data-active",
    );
  }
  await expect(page.getByRole("link", { name: "Hoy" })).not.toHaveAttribute("aria-current");
  // Moved here from the home page.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^Passkeys/ })).toHaveCount(0);
});

test("8 goes to Ajustes from anywhere (desktop)", async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo), "Shortcuts act from 1024 px");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
  await expect(sidebar(page).getByRole("link", { name: "Ajustes" })).toHaveAttribute(
    "aria-keyshortcuts",
    "8",
  );
  await page.keyboard.press("8");
  await expect(page).toHaveURL("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
});

test.describe("theme", () => {
  for (const [label, value] of [
    ["Claro", "light"],
    ["Oscuro", "dark"],
  ] as const) {
    test(`${label} is applied at once and survives a reload with no flash`, async ({ page }) => {
      await recordThemeChanges(page);
      // Start from the opposite theme, so the choice is a real change.
      await page.goto("/settings");
      await page.evaluate(
        (theme) => localStorage.setItem("theme", theme),
        value === "dark" ? "light" : "dark",
      );
      await page.reload();

      const option = themeGroup(page).getByRole("radio", { name: label });
      await option.click();
      await expect(option).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("html")).toHaveAttribute("data-theme", value);

      await page.reload();
      await expect(option).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("html")).toHaveAttribute("data-theme", value);
      // Since the reload started, <html> only ever had the chosen theme.
      expect(new Set(await themeChanges(page))).toEqual(new Set([value]));
    });
  }

  test("Sistema follows the device, also after a reload", async ({ page }) => {
    await recordThemeChanges(page);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); // the default

    // Arrow keys move the selection: Oscuro → Claro → Sistema.
    await themeGroup(page).getByRole("radio", { name: "Oscuro" }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const system = themeGroup(page).getByRole("radio", { name: "Sistema" });
    await expect(system).toBeFocused();
    await expect(system).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(system).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(new Set(await themeChanges(page))).toEqual(new Set(["dark"]));

    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();
    await expect(system).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(new Set(await themeChanges(page))).toEqual(new Set(["light"]));
  });
});

const markSameDocument = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true));
const isSameDocument = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true);

test("turning shortcuts off removes keys and hints at once; on brings them back", async ({
  page,
}, testInfo) => {
  const desktop = isDesktop(testInfo);
  // DOM-wide: below 1024 px the sidebar is hidden by CSS but still rendered.
  const hints = page.locator(".bo-sidebar kbd, [aria-keyshortcuts]");
  const listening = page.locator("html[data-nav-shortcuts='ready']");
  await page.goto("/settings");
  const toggle = shortcutsSwitch(page);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).toHaveAccessibleDescription(/contrae la barra lateral/);
  await expect(listening).toHaveCount(1);
  await expect(hints).not.toHaveCount(0);

  // Off: the layout re-renders from the cookie (router.refresh), without a full reload.
  await markSameDocument(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(listening).toHaveCount(0);
  await expect(hints).toHaveCount(0);
  expect(await isSameDocument(page)).toBe(true);

  if (desktop) {
    await toggle.blur();
    await recordKeys(page);
    for (const key of ["[", "1", "8"]) await page.keyboard.press(key);
    expect(await recordedKeys(page)).toEqual([
      { key: "[", prevented: false },
      { key: "1", prevented: false },
      { key: "8", prevented: false },
    ]);
    await expect(sidebar(page)).not.toHaveClass(/is-collapsed/);
    await expect(page).toHaveURL("/settings");
  }

  // The choice is kept: the server reads the cookie.
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(hints).toHaveCount(0);

  await markSameDocument(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(listening).toHaveCount(1);
  await expect(hints).not.toHaveCount(0);
  if (desktop) {
    await expect(sidebar(page).getByRole("link", { name: "Hoy" })).toHaveAttribute(
      "aria-keyshortcuts",
      "1",
    );
    await expect(sidebar(page).getByRole("link", { name: "Hoy" }).locator("kbd")).toBeVisible();
    await toggle.blur();
    await page.keyboard.press("1");
    await expect(page).toHaveURL("/");
  }
  expect(await isSameDocument(page)).toBe(true);
});

// The app's fixed bottom bar would cover the end of the page on phones.
const HIDE_APP_NAV = path.join(__dirname, "support/hide-app-nav.css");

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations and the reference screenshots`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/settings");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(themeGroup(page)).toBeVisible();
    await fontsLoaded(page);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    // Reduced motion: the switch knob jumps instead of sliding (its color may still fade).
    const knob = await shortcutsSwitch(page).evaluate(
      (element) => getComputedStyle(element, "::after").transitionDuration,
    );
    expect(knob.split(",")[0].trim()).toBe("0s");

    // The whole page minus the passkey list, which changes with other specs (passkey.spec.ts), and
    // the "Avisos" entry (reminders.spec.ts covers it), so this reference stays as it was.
    for (const name of [/^Passkeys/, "Avisos"]) {
      await page
        .getByRole("region", { name })
        .evaluate((element: HTMLElement) => (element.style.display = "none"));
    }
    await expectScreenshot(page.getByRole("main"), `settings-${theme}.png`, {
      stylePath: HIDE_APP_NAV,
    });
  });
}
