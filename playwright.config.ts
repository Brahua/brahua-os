import { defineConfig, devices } from "@playwright/test";
import { E2E_OWNER, OWNER_STORAGE_STATE } from "./e2e/support/owner";

const PORT = 3417;
const baseURL = `http://localhost:${PORT}`;

// The app under test runs against the throwaway TEST_DATABASE_URL (checked in global-setup.ts),
// with test-only auth values. Never production secrets or databases.
const appEnv = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
  BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
  BETTER_AUTH_URL: baseURL,
  OWNER_EMAIL: E2E_OWNER.email,
};

const desktopChrome = devices["Desktop Chrome"];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  // Screenshots are only compared inside the Linux Playwright container (CI or Docker),
  // so fonts render the same everywhere.
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
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: appEnv,
  },
});
