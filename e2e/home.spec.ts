import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { HOME_HEADING } from "./support/owner";

const THEMES = ["dark", "light"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(() => document.fonts.ready);
}

// The app sidebar is the banner landmark; the /design demos sit inside sections, so they are not.
const sidebar = (page: Page) => page.getByRole("banner");
const bottomNav = (page: Page) => page.locator(".bo-bottomnav--fixed");

/** Keys pressed before hydration go nowhere: wait until the navigation listens. */
async function shortcutsReady(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

async function openReady(page: Page, path: string) {
  await page.goto(path);
  await shortcutsReady(page);
}

test("home greets in Spanish with the date, inside the shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();
  await expect(page.locator("main header time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator("main")).toHaveAttribute("id", "content");
});

test("the navigation comes from the registry and marks the current page", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const desktop = testInfo.project.name === "desktop";

  // 390 px: bottom bar only. 1280 px: sidebar only.
  await expect(bottomNav(page)).toBeVisible({ visible: !desktop });
  await expect(sidebar(page)).toBeVisible({ visible: desktop });

  const nav = page.getByRole("navigation", { name: "Principal" });
  await expect(nav).toHaveCount(1);
  // Only available modules: Hoy today. Planned ones (Áreas, Ajustes) are not shown.
  await expect(nav.getByRole("link")).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Áreas" })).toHaveCount(0);

  // The capture key is in place but not available yet, and says so.
  const capture = page.getByRole("button", { name: "Capturar" }).filter({ visible: true });
  await expect(capture).toHaveAttribute("aria-disabled", "true");
  await expect(capture).toHaveAccessibleDescription("Próximamente");

  // Off the home page nothing is current.
  await page.goto("/design");
  await expect(nav.getByRole("link", { name: "Hoy" })).not.toHaveAttribute("aria-current");
  await nav.getByRole("link", { name: "Hoy" }).click();
  await expect(page).toHaveURL("/");
  await expect(nav.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
});

test("the content stays clear of the bottom bar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "The bottom bar is only shown on phones");
  await page.goto("/");
  const barHeight = await bottomNav(page).evaluate((el) => el.getBoundingClientRect().height);
  const padding = await page
    .locator("main")
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  expect(barHeight).toBe(98);
  expect(padding).toBeGreaterThanOrEqual(barHeight);
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations and the reference screenshot`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await setTheme(page, theme);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    // Fonts render differently per OS; references are only valid inside the Linux container.
    if (process.platform !== "linux") return;
    const desktop = testInfo.project.name === "desktop";
    await expect(desktop ? sidebar(page) : bottomNav(page)).toHaveScreenshot(
      `navigation-${theme}.png`,
    );
    if (desktop) {
      await shortcutsReady(page);
      await page.keyboard.press("[");
      await expect(sidebar(page)).toHaveClass(/is-collapsed/);
      await expect(sidebar(page)).toHaveScreenshot(`navigation-collapsed-${theme}.png`);
    }
  });
}

test.describe("keyboard shortcuts", () => {
  test("[ collapses the sidebar and the choice survives a reload with no flash", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The sidebar is only shown from 1024 px");
    await openReady(page, "/");
    await expect(sidebar(page)).not.toHaveClass(/is-collapsed/);

    await page.keyboard.press("[");
    await expect(sidebar(page)).toHaveClass(/is-collapsed/);
    await expect(page.getByRole("button", { name: "Expandir barra lateral" })).toBeVisible();
    await expect
      .poll(() => sidebar(page).evaluate((el) => el.getBoundingClientRect().width))
      .toBe(72);

    // The server already renders it collapsed (cookie), so the first paint is right.
    const html = await (await page.request.get("/")).text();
    expect(html).toMatch(/class="bo-sidebar is-collapsed/);
    await page.reload();
    await shortcutsReady(page);
    await expect(sidebar(page)).toHaveClass(/is-collapsed/);

    await page.keyboard.press("[");
    await expect(sidebar(page)).not.toHaveClass(/is-collapsed/);
    await expect
      .poll(() => sidebar(page).evaluate((el) => el.getBoundingClientRect().width))
      .toBe(240);
  });

  test("the toggle button collapses and expands the sidebar", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The sidebar is only shown from 1024 px");
    await openReady(page, "/");
    await page.getByRole("button", { name: "Contraer barra lateral" }).click();
    await expect(sidebar(page)).toHaveClass(/is-collapsed/);
    // Collapsed links keep their accessible names.
    await expect(
      page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Hoy" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Expandir barra lateral" }).click();
    await expect(sidebar(page)).not.toHaveClass(/is-collapsed/);
  });

  test("1 goes to the first registry item", async ({ page }) => {
    await openReady(page, "/design");
    await page.keyboard.press("1");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();
  });

  test("numbers without a module and modifier combinations do nothing", async ({ page }) => {
    await openReady(page, "/design");
    await page.keyboard.press("2");
    await page.keyboard.press("Alt+1");
    await page.keyboard.press("Shift+1");
    await expect(page).toHaveURL("/design");
  });

  test("shortcuts are ignored while typing in an input", async ({ page }, testInfo) => {
    await openReady(page, "/design");
    const field = page.getByRole("textbox", { name: "Tarea", exact: true });
    await field.fill("");
    await field.press("1");
    await field.press("[");
    await expect(field).toHaveValue("1[");
    await expect(page).toHaveURL("/design");
    if (testInfo.project.name === "desktop") {
      await expect(sidebar(page)).not.toHaveClass(/is-collapsed/);
    }
  });
});
