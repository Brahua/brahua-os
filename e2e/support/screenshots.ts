import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  expect,
  test,
  type Locator,
  type PageAssertionsToHaveScreenshotOptions,
} from "@playwright/test";
import { screenshotsEnabled } from "./screenshot-env";

const ENABLED = screenshotsEnabled();
const ANNOTATION = "screenshot-skipped";
const SKIP_REASON =
  "Visual references are only compared in the Linux Playwright image (CI, update-screenshots.yml or pnpm test:e2e:docker)";

// The references this run compared, one file per worker (read by scripts/check-screenshot-orphans.mjs).
// Inside Playwright's output dir, which every run cleans.
const USED_SCREENSHOTS_DIR = "test-results/.screenshots-used";

type ScreenshotOptions = Omit<PageAssertionsToHaveScreenshotOptions, "clip" | "fullPage">;

/**
 * The only way the specs compare screenshots (ESLint enforces it). Outside the Playwright image it
 * only annotates the test, once, so the skip shows in the report; the rest of the test
 * (behaviour, axe) still runs. Inside it, it also records which reference it used, so
 * scripts/check-screenshot-orphans.mjs can find references no test uses any more.
 */
export async function expectScreenshot(
  target: Locator,
  name: string,
  options?: ScreenshotOptions,
): Promise<void> {
  const info = test.info();
  if (!ENABLED) {
    if (!info.annotations.some((annotation) => annotation.type === ANNOTATION)) {
      info.annotations.push({ type: ANNOTATION, description: SKIP_REASON });
    }
    return;
  }
  const reference = path.relative(process.cwd(), info.snapshotPath(name, { kind: "screenshot" }));
  mkdirSync(USED_SCREENSHOTS_DIR, { recursive: true });
  appendFileSync(
    path.join(USED_SCREENSHOTS_DIR, `worker-${info.workerIndex}.txt`),
    `${reference}\n`,
  );
  await expect(target).toHaveScreenshot(name, options);
}
