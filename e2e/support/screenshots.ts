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

type ScreenshotOptions = Omit<PageAssertionsToHaveScreenshotOptions, "clip" | "fullPage">;

/**
 * The only way the specs compare screenshots (ESLint enforces it). Outside the Playwright image it
 * only annotates the test, once, so the skip shows in the report; the rest of the test
 * (behaviour, axe) still runs.
 */
export async function expectScreenshot(
  target: Locator,
  name: string,
  options?: ScreenshotOptions,
): Promise<void> {
  if (!ENABLED) {
    const { annotations } = test.info();
    if (!annotations.some((annotation) => annotation.type === ANNOTATION)) {
      annotations.push({ type: ANNOTATION, description: SKIP_REASON });
    }
    return;
  }
  await expect(target).toHaveScreenshot(name, options);
}
