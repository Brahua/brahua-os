import { expect, test } from "@playwright/test";

test("dark theme is the default and light theme can be applied", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(10, 10, 10)");

  // next-themes persists the choice in localStorage; reloading applies it before paint.
  await page.evaluate(() => localStorage.setItem("theme", "light"));
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(242, 242, 240)");

  expect(consoleErrors).toEqual([]);
});

test("design fonts are loaded", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  // Fonts load lazily per weight, so check the weights the page actually renders.
  const loaded = await page.evaluate(() => ({
    archivo: document.fonts.check('700 40px "Archivo"'),
    plexMono: document.fonts.check('500 11px "IBM Plex Mono"'),
  }));
  expect(loaded).toEqual({ archivo: true, plexMono: true });
});
