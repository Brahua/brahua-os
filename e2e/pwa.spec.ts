import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SECURITY_HEADERS } from "../next.config";
import { brandHex } from "../src/design-system/brand-colors";
import { OWNER_STORAGE_STATE } from "./support/owner";
import { pngSize } from "./support/png";

// Installing happens before signing in: everything here must work without a session.
test.use({ storageState: { cookies: [], origins: [] } });

async function expectPng(request: APIRequestContext, url: string, size: number) {
  const response = await request.get(url, { maxRedirects: 0 });
  expect(response.status(), url).toBe(200);
  expect(response.headers()["content-type"], url).toBe("image/png");
  expect(pngSize(await response.body()), url).toEqual({ width: size, height: size });
}

test("the manifest is public, installable and its icons exist", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^application\/manifest\+json/);
  for (const { key, value } of SECURITY_HEADERS)
    expect(response.headers()[key.toLowerCase()]).toBe(value);

  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "brahua-os",
    short_name: "brahua-os",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: brandHex("darkBackground"),
    theme_color: brandHex("darkBackground"),
  });
  expect(manifest.description).toEqual(expect.any(String));

  const icons: { src: string; sizes: string; type: string; purpose: string }[] = manifest.icons;
  expect(icons.map(({ sizes, purpose }) => `${sizes} ${purpose}`).sort()).toEqual([
    "192x192 any",
    "512x512 any",
    "512x512 maskable",
  ]);
  for (const icon of icons) {
    expect(icon.type).toBe("image/png");
    await expectPng(request, icon.src, Number(icon.sizes.split("x")[0]));
  }
});

test("/login links the manifest, the icons and the theme colors", async ({ page, request }) => {
  await page.goto("/login");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );

  const appleIcon = page.locator('link[rel="apple-touch-icon"]');
  await expect(appleIcon).toHaveAttribute("sizes", "180x180");
  await expectPng(request, (await appleIcon.getAttribute("href"))!, 180);

  const favicon = page.locator('link[rel="icon"]');
  await expect(favicon).toHaveCount(1);
  await expect(favicon).toHaveAttribute("type", "image/png");
  await expectPng(request, (await favicon.getAttribute("href"))!, 32);

  // iOS standalone ("Añadir a pantalla de inicio").
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "brahua-os",
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
    "content",
    "black",
  );
});

test("the server HTML has one theme-color per system scheme", async ({ browser }) => {
  // Without JavaScript, ThemeColorSync never runs: this is what the browser sees first.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/login");
  const themeColors = await page
    .locator('meta[name="theme-color"]')
    .evaluateAll((metas) =>
      metas.map((meta) => [meta.getAttribute("media"), meta.getAttribute("content")]),
    );
  expect(themeColors).toEqual([
    ["(prefers-color-scheme: dark)", brandHex("darkBackground")],
    ["(prefers-color-scheme: light)", brandHex("lightBackground")],
  ]);
  await context.close();
});

test("/favicon.ico redirects to the PNG favicon", async ({ request }) => {
  const response = await request.get("/favicon.ico", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe("/icon.png");
  await expectPng(request, "/icon.png", 32);
});

/** Both theme-color metas carry `color` (whatever their media query). */
async function expectThemeColor(page: Page, color: string) {
  const themeColors = page.locator('meta[name="theme-color"]');
  await expect(themeColors).toHaveCount(2);
  for (const meta of await themeColors.all()) await expect(meta).toHaveAttribute("content", color);
}

test("theme-color follows the app's theme, not only the system's", async ({ page }) => {
  // A light system with the default (dark) theme: the bar matches the dark page.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectThemeColor(page, brandHex("darkBackground"));

  // Light pinned in Ajustes on a dark system.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => localStorage.setItem("theme", "light"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectThemeColor(page, brandHex("lightBackground"));
});

test.describe("signed in", () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test("choosing Claro in Ajustes recolors the bar, also after a client navigation", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectThemeColor(page, brandHex("darkBackground"));

    const light = page
      .getByRole("radiogroup", { name: "Apariencia" })
      .getByRole("radio", { name: "Claro" });
    await light.click();
    await expect(light).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expectThemeColor(page, brandHex("lightBackground"));

    // Client-side: the marker survives only if the document is not reloaded.
    await page.evaluate(() => Object.assign(window, { __sameDocument: true }));
    await page.getByRole("link", { name: "Áreas", exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL("/areas");
    await expect(page.getByRole("heading", { level: 1, name: "Áreas" })).toBeVisible();
    expect(await page.evaluate(() => "__sameDocument" in window)).toBe(true);
    await expectThemeColor(page, brandHex("lightBackground"));
  });
});
