import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page renders in Spanish with no accessibility violations", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "brahua-os" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
