import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";
import { expectScreenshot } from "./support/screenshots";
import { boardTest } from "./support/today-tasks";
import { HOME_HEADING } from "./support/owner";

/**
 * For the tests that measure "/" (width, axe): the board shows every habit and task due today, so
 * they hold the habits and tasks locks and start with an empty board (e2e/support/today-tasks.ts).
 */
const homeLocked = boardTest;

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
  // Only available modules: Hoy, Proyectos, Tareas, Hábitos, Áreas and Ajustes. On desktop Áreas
  // and Ajustes are pinned to the sidebar footer; on the phone six don't fit around the capture
  // key, so Hábitos takes the cell after it (SPEC-habits) and Tareas, Áreas and Ajustes go
  // under "Más".
  const links = page.getByRole("navigation").getByRole("link");
  if (desktop) {
    await expect(links).toHaveCount(6);
    await expect(links.nth(0)).toHaveAccessibleName("Hoy");
    await expect(links.nth(1)).toHaveAccessibleName("Proyectos");
    await expect(links.nth(2)).toHaveAccessibleName("Tareas");
    await expect(links.nth(3)).toHaveAccessibleName("Hábitos");
    await expect(links.nth(4)).toHaveAccessibleName("Áreas");
    await expect(links.nth(5)).toHaveAccessibleName("Ajustes");
    const footer = page.getByRole("navigation", { name: "Secundaria" });
    await expect(footer.getByRole("link", { name: "Áreas" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Ajustes" })).toBeVisible();
  } else {
    await expect(links).toHaveCount(3);
    await expect(links.nth(0)).toHaveAccessibleName("Hoy");
    await expect(links.nth(1)).toHaveAccessibleName("Proyectos");
    await expect(links.nth(2)).toHaveAccessibleName("Hábitos");
    // Hábitos is right after the capture key (cell 4); "Más" is the last cell.
    const cells = await bottomNav(page).evaluate((bar) =>
      [...bar.children].map((child) => ({
        name: child.querySelector("[aria-label]")?.getAttribute("aria-label") ?? child.textContent,
        left: child.getBoundingClientRect().left,
      })),
    );
    const order = [...cells].sort((a, b) => a.left - b.left).map((cell) => cell.name);
    expect(order).toEqual(["Hoy", "Proyectos", "Capturar", "Hábitos", "Más"]);
  }
  await expect(nav.getByRole("link", { name: "Proyectos" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");

  // The capture key opens quick capture (SPEC-tasks): available, a dialog behind it.
  const capture = page.getByRole("button", { name: "Capturar" });
  await expect(capture).not.toHaveAttribute("aria-disabled");
  await expect(capture).toHaveAttribute("aria-haspopup", "dialog");

  // Off the home page nothing is current.
  await page.goto("/design");
  await expect(nav.getByRole("link", { name: "Hoy" })).not.toHaveAttribute("aria-current");
  await nav.getByRole("link", { name: "Hoy" }).click();
  await expect(page).toHaveURL("/");
  await expect(nav.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
});

test("the capture key opens quick capture and focus returns to it on close", async ({
  page,
}, testInfo) => {
  await openReady(page, "/");
  const key = (isDesktop(testInfo) ? sidebar(page) : bottomNav(page)).getByRole("button", {
    name: "Capturar",
  });
  await key.click();
  const sheet = page.getByRole("dialog", { name: "Nueva tarea" });
  await expect(sheet.getByRole("textbox", { name: "¿Qué hay que hacer?" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(key).toBeFocused();
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

homeLocked(
  "at 320 px the bottom bar doesn't overflow; labels truncate",
  async ({ page }, testInfo) => {
    test.skip(isDesktop(testInfo), "Phone widths only");
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );

    await page.goto("/design");
    // The /design demo has the full design (Proyectos, Hábitos, Más).
    const demo = page.getByRole("navigation", { name: "Ejemplo de barra inferior" });
    await demo.scrollIntoViewIfNeeded();
    const overflow = await demo.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(demo.getByRole("link", { name: "Proyectos" })).toBeVisible();
  },
);

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
  homeLocked(
    `${theme} theme: no accessibility violations and the reference screenshot`,
    async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await setTheme(page, theme);

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);

      const desktop = isDesktop(testInfo);
      await expectScreenshot(desktop ? sidebar(page) : bottomNav(page), `navigation-${theme}.png`);
      if (desktop) {
        await shortcutsReady(page);
        await page.keyboard.press("[");
        await expect(sidebar(page)).toHaveClass(/is-collapsed/);
        await expectScreenshot(sidebar(page), `navigation-collapsed-${theme}.png`);
      }
    },
  );
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
  // The time of the pointer entering is taken in the page, so a slow round trip can't make the
  // check run after the 300 ms delay: it only counts when it ran well inside it.
  await tooltip.evaluate((element) => {
    element.parentElement!.addEventListener(
      "pointerenter",
      () => ((window as unknown as { __enteredAt: number }).__enteredAt = performance.now()),
      { once: true },
    );
  });
  await link.hover();
  const during = await tooltip.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      elapsed: performance.now() - (window as unknown as { __enteredAt: number }).__enteredAt,
      visibility: getComputedStyle(element).visibility,
      caught: element.contains(hit),
    };
  });
  // During the 300 ms delay it is still hidden and lets the pointer through.
  expect(during.elapsed).toBeGreaterThanOrEqual(0);
  if (during.elapsed < 250) {
    expect({ visibility: during.visibility, caught: during.caught }).toEqual({
      visibility: "hidden",
      caught: false,
    });
  } else {
    testInfo.annotations.push({
      type: "skipped-check",
      description: `hidden-tooltip check ran ${Math.round(during.elapsed)} ms after hover`,
    });
  }
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

    // 5 and 6 are unbound (their modules don't exist yet; 2 is Proyectos, 3 Tareas, 4 Hábitos).
    for (const key of ["5", "6", "Meta+1", "Control+1", "Shift+1"]) {
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
    await page.keyboard.press("c");
    expect(await recordedKeys(page)).toEqual([
      { key: "[", prevented: false },
      { key: "1", prevented: false },
      { key: "c", prevented: false },
    ]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(sidebar(page)).toHaveClass(/is-collapsed/);
    await expect(page).toHaveURL("/design");
  });
});
