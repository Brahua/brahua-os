// Where screenshot references are valid: Linux, inside the official Playwright image that CI's
// E2E job and update-screenshots.yml run in (fonts and rendering differ everywhere else). That
// image sets PLAYWRIGHT_BROWSERS_PATH=/ms-playwright.
// E2E_SCREENSHOTS=1 forces the comparisons on (e.g. another Linux setup), E2E_SCREENSHOTS=0 off.
// No Playwright imports: playwright.config.ts and the unit tests read it too.

const PLAYWRIGHT_IMAGE_BROWSERS = "/ms-playwright";

export function screenshotsEnabled(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): boolean {
  if (env.E2E_SCREENSHOTS === "1") return true;
  if (env.E2E_SCREENSHOTS === "0") return false;
  return platform === "linux" && env.PLAYWRIGHT_BROWSERS_PATH === PLAYWRIGHT_IMAGE_BROWSERS;
}
