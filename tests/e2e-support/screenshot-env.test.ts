import { expect, test } from "vitest";
import { screenshotsEnabled } from "../../e2e/support/screenshot-env";

const IMAGE = { PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" };

test("compares screenshots only on Linux inside the Playwright image", () => {
  expect(screenshotsEnabled(IMAGE, "linux")).toBe(true);
  expect(screenshotsEnabled({}, "linux")).toBe(false);
  expect(screenshotsEnabled(IMAGE, "darwin")).toBe(false);
  expect(screenshotsEnabled({}, "darwin")).toBe(false);
});

test("E2E_SCREENSHOTS forces them on or off", () => {
  expect(screenshotsEnabled({ E2E_SCREENSHOTS: "1" }, "darwin")).toBe(true);
  expect(screenshotsEnabled({ ...IMAGE, E2E_SCREENSHOTS: "0" }, "linux")).toBe(false);
});
