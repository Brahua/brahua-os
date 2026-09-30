import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { fontsLoaded } from "./support/fonts";

const THEMES = ["dark", "light"] as const;
const SECTIONS = [
  "key",
  "icon-key",
  "kbd-tooltip",
  "icon",
  "led",
  "area-tag",
  "area-icons",
  "section-label",
  "stat-number",
  "progress",
  "week",
  "lcd",
  "controls",
  "text-field",
  "sheet",
  "list-row",
  "navigation",
];
const HIDE_APP_NAV = path.join(__dirname, "support/hide-app-nav.css");

async function openGuide(page: Page, theme: (typeof THEMES)[number]) {
  await page.goto("/design");
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await fontsLoaded(page);
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test("has no accessibility violations", async ({ page }) => {
      await openGuide(page, theme);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test("key sections match the reference screenshots", async ({ page }) => {
      // Fonts render differently per OS; references are only valid inside the Linux container.
      test.skip(process.platform !== "linux", "Visual references are generated on Linux only");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openGuide(page, theme);
      for (const id of SECTIONS) {
        await expect(page.locator(`[data-guide-section="${id}"]`)).toHaveScreenshot(
          `${id}-${theme}.png`,
          { stylePath: HIDE_APP_NAV },
        );
      }
    });
  });
}

test("toggle key works with the keyboard", async ({ page }) => {
  await page.goto("/design");
  const key = page.getByTestId("toggle-key");

  await key.focus();
  await expect(key).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Space");
  await expect(key).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(key).toHaveAttribute("aria-pressed", "false");
});

test("key sinks 3px while pressed", async ({ page }) => {
  await page.goto("/design");
  const key = page.getByRole("button", { name: "Guardar" }).first();

  await key.hover();
  await page.mouse.down();
  // translateY(var(--motion-travel)) = 3px
  await expect(key).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 3)");
  await page.mouse.up();
});

test("key does not move while pressed with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design");
  const key = page.getByRole("button", { name: "Guardar" }).first();

  await key.hover();
  await page.mouse.down();
  // --motion-travel is 0px with reduced motion
  await expect(key).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await page.mouse.up();
});

test("every area LED renders its color", async ({ page }) => {
  // Guards against Tailwind dropping theme variables that are only referenced from inline styles.
  await page.goto("/design");
  const fills = await page.locator('[data-guide-section="led"] .bo-led').evaluateAll((leds) =>
    leds.map((led) => {
      const style = getComputedStyle(led);
      // The signal LED is painted with a gradient (background-image) instead of a color.
      return { color: style.backgroundColor, image: style.backgroundImage };
    }),
  );

  expect(fills.length).toBeGreaterThanOrEqual(24);
  for (const fill of fills) {
    expect(fill.color !== "rgba(0, 0, 0, 0)" || fill.image !== "none").toBe(true);
  }
});

test("animated numbers are read as one formatted value", async ({ page }) => {
  await page.goto("/design");
  const section = page.locator('[data-guide-section="stat-number"]');

  const before = await section.ariaSnapshot();
  expect(before).toContain("S/ 2,340");
  expect(before).not.toContain("2 , 3 4 0");

  await section.getByRole("button", { name: "Sumar" }).click();
  await expect.poll(() => section.ariaSnapshot()).toContain("S/ 2,465.5");
});

for (const { trigger, name } of [
  { trigger: "Capturar", name: "Captura rápida" },
  { trigger: "Ver proyecto", name: "Certificación AWS" },
]) {
  test(`sheet "${name}" opens accessibly, closes with Esc and returns focus`, async ({ page }) => {
    await page.goto("/design");
    const button = page
      .locator('[data-guide-section="sheet"]')
      .getByRole("button", { name: trigger });

    await button.click();
    const dialog = page.getByRole("dialog", { name });
    await expect(dialog).toBeVisible();

    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(results.violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  });
}
