// Where screenshot references are valid: Linux, inside the official Playwright image that CI's
// E2E job and update-screenshots.yml run in (fonts and rendering differ everywhere else). That
// image sets PLAYWRIGHT_BROWSERS_PATH=/ms-playwright.
// E2E_SCREENSHOTS=1 forces the comparisons on (e.g. another Linux setup). E2E_SCREENSHOTS=0 turns
// them off, except on GitHub Actions: there the gate can never be switched off (playwright.config
// throws if they would not run).
// No Playwright imports: playwright.config.ts and the unit tests read it too.

const PLAYWRIGHT_IMAGE_BROWSERS = "/ms-playwright";

export function screenshotsEnabled(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): boolean {
  if (env.E2E_SCREENSHOTS === "1") return true;
  if (env.E2E_SCREENSHOTS === "0" && !isGitHubActions(env)) return false;
  return platform === "linux" && env.PLAYWRIGHT_BROWSERS_PATH === PLAYWRIGHT_IMAGE_BROWSERS;
}

export function isGitHubActions(env: Record<string, string | undefined> = process.env): boolean {
  return env.GITHUB_ACTIONS === "true";
}
