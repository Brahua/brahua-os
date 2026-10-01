import type { Page } from "@playwright/test";

/**
 * Waits until no CSS transition or animation is running. Keys fade their colors on press
 * (--duration-hover, not zeroed by reduced motion); axe measuring contrast mid-fade sees blended
 * colors and reports a violation that isn't there once the key settles.
 */
export async function animationsSettled(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
}
