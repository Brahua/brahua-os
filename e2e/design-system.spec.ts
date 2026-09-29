import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const THEMES = ["dark", "light"] as const;

async function openGuide(page: Page, theme: (typeof THEMES)[number]) {
  await page.goto("/design");
  await page.evaluate((value) => localStorage.setItem("theme", value), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(() => document.fonts.ready);
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
      for (const id of ["key", "icon-key", "icon"]) {
        await expect(page.locator(`[data-guide-section="${id}"]`)).toHaveScreenshot(
          `${id}-${theme}.png`,
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
  // Tailwind v4 translate utilities use the CSS `translate` property, not `transform`.
  await expect(key).toHaveCSS("translate", "0px 3px");
  await page.mouse.up();
});

test("key does not move while pressed with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design");
  const key = page.getByRole("button", { name: "Guardar" }).first();

  await key.hover();
  await page.mouse.down();
  await expect(key).toHaveCSS("translate", "none");
  await page.mouse.up();
});
