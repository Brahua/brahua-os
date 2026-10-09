import { defineConfig, devices } from "@playwright/test";
import { E2E_OWNER, OWNER_STORAGE_STATE } from "./e2e/support/owner";
import { E2E_TELEGRAM, FAKE_TELEGRAM_PORT } from "./e2e/support/reminders-env";
import { isGitHubActions, screenshotsEnabled } from "./e2e/support/screenshot-env";

// E2E_PORT lets parallel local runs (several worktrees) use different ports; CI uses the default.
const PORT = Number(process.env.E2E_PORT ?? 3417);
const baseURL = `http://localhost:${PORT}`;

// The app under test runs against the throwaway TEST_DATABASE_URL (checked in global-setup.ts),
// with test-only auth values. Never production secrets or databases. Locally it defaults to the
// `pnpm db:test:start` database (scripts/test-db.ts), which global-setup.ts starts if needed.
if (!process.env.CI && !process.env.TEST_DATABASE_URL) {
  process.env.TEST_DATABASE_URL = `postgres://postgres:postgres@localhost:${process.env.TEST_DB_PORT ?? 54329}/brahua_os_test`;
}
const appEnv = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
  BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
  BETTER_AUTH_URL: baseURL,
  OWNER_EMAIL: E2E_OWNER.email,
  // Builds and enables the test-only routes that force errors (src/lib/e2e-error-routes.ts).
  E2E_ERROR_ROUTES: "1",
  // `reminders`: test-only bot values and the fake Telegram Bot API started below. The app talks
  // to it through the same TELEGRAM_API_BASE the production code reads (no test branches).
  TELEGRAM_BOT_TOKEN: E2E_TELEGRAM.token,
  TELEGRAM_WEBHOOK_SECRET: E2E_TELEGRAM.webhookSecret,
  TELEGRAM_BOT_USERNAME: E2E_TELEGRAM.botUsername,
  REMINDERS_CRON_SECRET: E2E_TELEGRAM.cronSecret,
  TELEGRAM_API_BASE: `http://127.0.0.1:${FAKE_TELEGRAM_PORT}`,
};

const desktopChrome = devices["Desktop Chrome"];

// On GitHub Actions the screenshot gate must never turn itself off (wrong image, a stray env var).
if (isGitHubActions() && !screenshotsEnabled()) {
  throw new Error(
    "Screenshot comparisons are off on GitHub Actions: E2E must run in the Playwright image (PLAYWRIGHT_BROWSERS_PATH=/ms-playwright).",
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI also writes playwright-results.json: scripts/e2e-timing-summary.mjs turns it into the
  // timing summary of the job (docs/HANDOFF.md, "CI: E2E y el gate del deploy").
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["json", { outputFile: "playwright-results.json" }]]
    : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  // Screenshots are only compared inside the Linux Playwright image (CI and update-screenshots.yml),
  // so fonts render the same. Elsewhere (macOS while iterating) every comparison is
  // skipped: specs call expectScreenshot() (e2e/support/screenshots.ts), which also annotates the
  // skip in the report, and this is the safety net for anything else.
  ignoreSnapshots: !screenshotsEnabled(),
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  projects: [
    // Signs in once through the login form; the app specs reuse that session.
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...desktopChrome } },
    {
      name: "mobile",
      use: {
        ...desktopChrome,
        viewport: { width: 390, height: 844 },
        storageState: OWNER_STORAGE_STATE,
      },
      dependencies: ["setup"],
      // Only the tests whose behaviour depends on the phone viewport (tagged `@responsive` in the
      // title: layout, navigation, sheets, pads, screenshots). `desktop` runs everything. The rule
      // and the lint that enforces it: docs/HANDOFF.md, "E2E: qué corre en `mobile`".
      grep: /@responsive/,
      // `reminder_settings` is a single row shared by the whole app: its spec runs in one project.
      testIgnore: /reminders\.spec\.ts/,
    },
    {
      name: "desktop",
      use: {
        ...desktopChrome,
        viewport: { width: 1280, height: 800 },
        storageState: OWNER_STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    // The fake Telegram Bot API (reminders): the app's TELEGRAM_API_BASE points here.
    {
      command: "pnpm exec tsx e2e/support/fake-telegram-server.ts",
      url: `http://127.0.0.1:${FAKE_TELEGRAM_PORT}/__health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { E2E_TELEGRAM_PORT: String(FAKE_TELEGRAM_PORT) },
    },
    {
      command: `pnpm build && pnpm start --port ${PORT}`,
      url: `${baseURL}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: appEnv,
    },
  ],
});
