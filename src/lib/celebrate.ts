// celebration-milestones (corte `polish`): the confetti of a streak milestone. Client-only.
// Monochrome in the color of the habit's area, brief (<= 800 ms) and never under
// prefers-reduced-motion: the notice already celebrates in words (principle 15, "only at
// milestones").
import type { AreaColor } from "@/design-system/areas";

/** The streak from which a milestone also gets confetti (7 is celebrated in words only). */
export const CONFETTI_FROM = 30;

/** Total length of the animation: `ticks` frames at ~60 fps stay under it. */
export const CONFETTI_MAX_MS = 800;
const TICKS = 45;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether a milestone of this streak (days or weeks) gets confetti. */
export function hasConfetti(count: number): boolean {
  return count >= CONFETTI_FROM;
}

/** `rgb(92, 203, 138)` (what a computed color is) as the `5ccb8a` hex the library parses. */
function toHex(rgb: string): string | null {
  const channels = rgb
    .match(/\d+(\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length < 3) return null;
  return channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("");
}

/** The computed color of a CSS custom property (it may be another `var()`), as hex. */
function resolve(property: string): string | null {
  const probe = document.createElement("span");
  probe.style.color = `var(${property})`;
  probe.hidden = true;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const hex = toHex(color);
  return hex ? `#${hex}` : null;
}

/** The area's bright tone (`--area-<color>-bright`), or the primary text color without an area. */
function toneOf(area: AreaColor | null | undefined): string | null {
  return (area ? resolve(`--area-${area}-bright`) : null) ?? resolve("--color-text");
}

/**
 * Confetti for a streak milestone of `count` days or weeks. Does nothing below 30, under reduced
 * motion, or where there is no canvas (tests); the library loads only when it is needed.
 */
export async function celebrateStreak(
  count: number,
  area: AreaColor | null | undefined,
): Promise<void> {
  if (typeof window === "undefined" || !hasConfetti(count)) return;
  if (window.matchMedia(REDUCED_MOTION).matches) return;
  try {
    const { default: confetti } = await import("canvas-confetti");
    // The preference can change while the library loads.
    if (window.matchMedia(REDUCED_MOTION).matches) return;
    const tone = toneOf(area);
    if (!tone) return;
    await confetti({
      particleCount: 36,
      spread: 70,
      startVelocity: 28,
      origin: { y: 0.7 },
      colors: [tone],
      shapes: ["square"],
      ticks: TICKS,
      scalar: 0.9,
      gravity: 1.1,
      disableForReducedMotion: true,
      // Over the page, under the notice: the confetti never covers the focused control's reply.
      zIndex: 40,
    });
  } catch {
    // Confetti is a flourish: a missing canvas or a failed chunk never gets in the way.
  }
}
