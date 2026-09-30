import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { HOME_HEADING } from "./support/owner";

const THEMES = ["dark", "light"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await fontsLoaded(page);
}

// The app sidebar is the banner landmark; the /design demos sit inside sections, so they are not.
const sidebar = (page: Page) => page.getByRole("banner");
const bottomNav = (page: Page) => page.locator(".bo-bottomnav--fixed");
const isDesktop = (testInfo: TestInfo) => testInfo.project.name === "desktop";

/** A design token in px, as the stylesheet defines it (e.g. `--sidebar-width` → 240). */
async function tokenPx(page: Page, name: string): Promise<number> {
  const value = await page.evaluate(
    (token) => getComputedStyle(document.documentElement).getPropertyValue(token),
    name,
  );
  expect(value.trim()).toMatch(/^\d+(\.\d+)?px$/);
  return parseFloat(value);
}

const width = (page: Page) =>
  sidebar(page).evaluate((element) => element.getBoundingClientRect().width);

/** Keys pressed before hydration go nowhere: wait until the navigation listens. */
async function shortcutsReady(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-nav-shortcuts", "ready");
}

async function openReady(page: Page, path: string) {
  await page.goto(path);
  await shortcutsReady(page);
}

/**
 * Records, for every keydown, whether a handler called preventDefault(). The listener goes on
 * `window` after AppNav's (registered on hydration), so it sees the event after AppNav did.
 */
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

test("home greets in Spanish with the date, inside the shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Hoy · brahua-os");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();
  await expect(page.locator("main header time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator("main")).toHaveAttribute("id", "content");
});

test("the navigation comes from the registry and marks the current page", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const desktop = isDesktop(testInfo);

  // 390 px: bottom bar only. 1280 px: sidebar only.
  await expect(bottomNav(page)).toBeVisible({ visible: !desktop });
  await expect(sidebar(page)).toBeVisible({ visible: desktop });

  const nav = page.getByRole("navigation", { name: "Principal" });
  await expect(nav).toHaveCount(1);
  // Only available modules: Hoy and Ajustes. Planned ones (Áreas) are not shown. On the phone
  // both fit in the bottom bar; on desktop Ajustes is pinned to the sidebar footer.
  const links = page.getByRole("navigation").getByRole("link");
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAccessibleName("Hoy");
  await expect(links.nth(1)).toHaveAccessibleName("Ajustes");
  const footer = desktop ? page.getByRole("navigation", { name: "Secundaria" }) : nav;
  await expect(footer.getByRole("link", { name: "Ajustes" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Áreas" })).toHaveCount(0);

  // The capture key is in place but not available yet, and says so.
  const capture = page.getByRole("button", { name: "Capturar" });
  await expect(capture).toHaveAttribute("aria-disabled", "true");
  await expect(capture).toHaveAccessibleDescription("Próximamente");

  // Off the home page nothing is current.
  await page.goto("/design");
  await expect(nav.getByRole("link", { name: "Hoy" })).not.toHaveAttribute("aria-current");
  await nav.getByRole("link", { name: "Hoy" }).click();
  await expect(page).toHaveURL("/");
  await expect(nav.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
});

test("tapping the unavailable capture key shows why", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Touch has no hover: this is the phone fallback");
  await openReady(page, "/");
  const hint = bottomNav(page).getByRole("tooltip", { includeHidden: true });
  await expect(hint).toHaveCSS("opacity", "0");
  // aria-disabled (not disabled): it still takes the tap, which Playwright calls "not enabled".
  await bottomNav(page).getByRole("button", { name: "Capturar" }).click({ force: true });
  await expect(hint).toHaveText("Próximamente");
  await expect(hint).toHaveCSS("opacity", "1");
});

test("the content and focused elements stay clear of the bottom bar", async ({
  page,
}, testInfo) => {
  test.skip(isDesktop(testInfo), "The bottom bar is only shown on phones");
  await page.goto("/");
  const barHeight = await bottomNav(page).evaluate((el) => el.getBoundingClientRect().height);
  expect(barHeight).toBeGreaterThanOrEqual(await tokenPx(page, "--bottom-nav-height"));

  const main = page.locator("main");
  const padding = await main.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  expect(padding).toBeGreaterThanOrEqual(barHeight);

  // WCAG 2.4.11: what gets focus is scrolled above the bar, not under it.
  const scrollPadding = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
  );
  expect(scrollPadding).toBeGreaterThanOrEqual(barHeight);
});

test("at 320 px the bottom bar doesn't overflow; labels truncate", async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), "Phone widths only");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.goto("/design");
  // The /design demo has the full design (Proyectos, Hábitos, Más).
  const demo = page.getByRole("navigation", { name: "Ejemplo de barra inferior" });
  await demo.scrollIntoViewIfNeeded();
  const overflow = await demo.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(demo.getByRole("link", { name: "Proyectos" })).toBeVisible();
});

test("Más opens its sections and returns focus to itself on close", async ({ page }) => {
  await page.goto("/design");
  const demo = page.getByRole("navigation", { name: "Ejemplo de barra inferior" });
  const more = demo.getByRole("button", { name: "Más" });
  await more.click();
  const sheet = page.getByRole("dialog", { name: "Más" });
  await expect(sheet.getByRole("navigation", { name: "Más secciones" })).toBeVisible();
  await expect(sheet.getByRole("link")).toHaveCount(5);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();
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
    const desktop = isDesktop(testInfo);
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

test("a tooltip stays open while hovered and Esc dismisses it (WCAG 1.4.13)", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo), "Hover tooltips are a desktop pattern");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openReady(page, "/");
  await page.getByRole("button", { name: "Contraer barra lateral" }).click();

  const link = sidebar(page).getByRole("link", { name: "Hoy" });
  const tooltip = sidebar(page).locator(".bo-tooltip", { hasText: "Hoy" });
  // Not showing yet: it must not catch the pointer (it sits over the content next to it).
  await expect(tooltip).toHaveCSS("visibility", "hidden");
  await link.hover();
  const hidden = await tooltip.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { visibility: getComputedStyle(element).visibility, caught: element.contains(hit) };
  });
  // Right after hovering, during the 300 ms delay, it is still hidden and lets the pointer through.
  expect(hidden).toEqual({ visibility: "hidden", caught: false });
  await expect(tooltip).toHaveCSS("opacity", "1");
  await expect(tooltip).toHaveCSS("visibility", "visible");

  // Move onto the tooltip itself, crossing the 8 px gap: it stays.
  const box = (await tooltip.boundingBox())!;
  await page.mouse.move(box.x - 4, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await expect(tooltip).toHaveCSS("opacity", "1");

  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCSS("opacity", "0");
  // Dismissed until the pointer leaves; hovering again shows it.
  await page.mouse.move(600, 400);
  await link.hover();
  await expect(tooltip).toHaveCSS("opacity", "1");
});

test.describe("keyboard shortcuts", () => {
  test("[ collapses the sidebar and the choice survives a reload with no flash", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo), "The sidebar is only shown from 1024 px");
    await openReady(page, "/");
    const full = await tokenPx(page, "--sidebar-width");
    const narrow = await tokenPx(page, "--sidebar-width-collapsed");
    await expect(sidebar(page)).not.toHaveClass(/is-collapsed/);
    await expect.poll(() => width(page)).toBe(full);

    await page.keyboard.press("[");
    await expect(sidebar(page)).toHaveClass(/is-collapsed/);
    await expect(page.getByRole("button", { name: "Expandir barra lateral" })).toBeVisible();
    await expect.poll(() => width(page)).toBe(narrow);

    // The server already renders it collapsed (cookie), so the first paint is right.
    const html = await (await page.request.get("/")).text();
    expect(html).toMatch(/class="bo-sidebar is-collapsed/);
    await page.reload();
    await shortcutsReady(page);
    await expect(sidebar(page)).toHaveClass(/is-collapsed/);

    await page.keyboard.press("[");
    await expect(sidebar(page)).not.toHaveClass(/is-collapsed/);
    await expect.poll(() => width(page)).toBe(full);
  });

  test("the toggle button collapses and expands the sidebar", async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo), "The sidebar is only shown from 1024 px");
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

  test("1 and ⌥1 go to Hoy", async ({ page }, testInfo) => {
    test.skip(!isDesktop(testInfo), "Shortcuts act from 1024 px");
    await openReady(page, "/design");
    await page.keyboard.press("1");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();

    await openReady(page, "/design");
    await page.keyboard.press("Alt+1");
    await expect(page).toHaveURL("/");
  });

  test("unbound numbers and ⌘/Ctrl/Shift combinations are left alone", async ({
    page,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo), "Shortcuts act from 1024 px");
    await openReady(page, "/design");
    await recordKeys(page);
    const historyLength = await page.evaluate(() => history.length);

    // 2 is unbound; 7 is Áreas, still planned.
    for (const key of ["2", "7", "Meta+1", "Control+1", "Shift+1"]) {
      await page.keyboard.press(key);
    }
    const keys = (await recordedKeys(page)) as { key: string; prevented: boolean }[];
    const presses = keys.filter((entry) => !["Meta", "Control", "Shift"].includes(entry.key));
    expect(presses).toHaveLength(5);
    expect(presses.every((entry) => !entry.prevented)).toBe(true);
    await expect(page).toHaveURL("/design");
    expect(await page.evaluate(() => history.length)).toBe(historyLength);

    // The handler is alive: a bound key right after does act.
    await page.keyboard.press("1");
    await expect(page).toHaveURL("/");
  });

  test("shortcuts are ignored while typing in an input", async ({ page }, testInfo) => {
    await openReady(page, "/design");
    const field = page.getByRole("textbox", { name: "Tarea", exact: true });
    await field.fill("");
    await recordKeys(page);
    await field.press("1");
    await field.press("[");
    await expect(field).toHaveValue("1[");
    expect(await recordedKeys(page)).toEqual([
      { key: "1", prevented: false },
      { key: "[", prevented: false },
    ]);
    await expect(page).toHaveURL("/design");

    if (isDesktop(testInfo)) {
      await expect(sidebar(page)).not.toHaveClass(/is-collapsed/);
      // Outside the input the same key works: the listener was there all along.
      await field.blur();
      await page.keyboard.press("[");
      await expect(sidebar(page)).toHaveClass(/is-collapsed/);
    }
  });

  test("below 1024 px number keys don't navigate", async ({ page }, testInfo) => {
    test.skip(isDesktop(testInfo), "Phone widths only");
    await openReady(page, "/design");
    await recordKeys(page);
    await page.keyboard.press("1");
    expect(await recordedKeys(page)).toEqual([{ key: "1", prevented: false }]);
    await expect(page).toHaveURL("/design");
  });

  test("with shortcuts turned off (bo_shortcuts=off) nothing listens and no hints show", async ({
    page,
    baseURL,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo), "The hints live in the sidebar");
    await page.context().addCookies([{ name: "bo_shortcuts", value: "off", url: baseURL! }]);
    await page.goto("/design");
    await expect(sidebar(page).locator("[aria-keyshortcuts]")).toHaveCount(0);
    await expect(sidebar(page).locator("kbd")).toHaveCount(0);

    // Hydrated (the button works), yet no listener and no readiness marker.
    await sidebar(page).getByRole("button", { name: "Contraer barra lateral" }).click();
    await expect(sidebar(page)).toHaveClass(/is-collapsed/);
    await expect(page.locator("html")).not.toHaveAttribute("data-nav-shortcuts");

    await recordKeys(page);
    await page.keyboard.press("[");
    await page.keyboard.press("1");
    expect(await recordedKeys(page)).toEqual([
      { key: "[", prevented: false },
      { key: "1", prevented: false },
    ]);
    await expect(sidebar(page)).toHaveClass(/is-collapsed/);
    await expect(page).toHaveURL("/design");
  });
});
