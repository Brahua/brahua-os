import type { Page } from "@playwright/test";

/**
 * Waits until no CSS transition or animation is running, and the entry cascade (Motion's frames,
 * not CSS: `Cascade` marks its blocks) has shown every block. Keys fade their colors on press
 * (--duration-hover, not zeroed by reduced motion); axe measuring contrast mid-fade sees blended
 * colors and reports a violation that isn't there once the key settles.
 */
export async function animationsSettled(page: Page) {
  await page.waitForFunction(
    () =>
      document.getAnimations().every((animation) => animation.playState !== "running") &&
      Array.from(document.querySelectorAll("[data-motion-cascade]")).every(
        (block) => getComputedStyle(block).opacity === "1",
      ),
  );
}
