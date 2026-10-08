// celebration-milestones: the confetti of a streak milestone. Only from 30, in the area's tone,
// never under reduced motion, and a failure of the library never surfaces.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { celebrateStreak, CONFETTI_FROM, CONFETTI_MAX_MS, hasConfetti } from "@/lib/celebrate";

const fire = vi.hoisted(() => vi.fn());
vi.mock("canvas-confetti", () => ({ default: fire }));

function motion(reduced: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  fire.mockReset().mockResolvedValue(null);
  motion(false);
  // jsdom does not resolve var() in a computed color: answer by the property the probe asks for.
  const colors: Record<string, string> = {
    "--area-health-bright": "rgb(92, 203, 138)",
    "--color-text": "rgb(17, 17, 17)",
  };
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element) =>
      ({
        color: colors[/var\((.+)\)/.exec((element as HTMLElement).style.color)?.[1] ?? ""] ?? "",
      }) as CSSStyleDeclaration,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("celebrateStreak", () => {
  test("confetti starts at 30 (7 is celebrated in words only)", () => {
    expect(CONFETTI_FROM).toBe(30);
    expect(hasConfetti(7)).toBe(false);
    expect(hasConfetti(29)).toBe(false);
    expect(hasConfetti(30)).toBe(true);
    expect(hasConfetti(90)).toBe(true);
    expect(hasConfetti(365)).toBe(true);
  });

  test("below 30: nothing is fired", async () => {
    await celebrateStreak(7, "health");
    expect(fire).not.toHaveBeenCalled();
  });

  test("at 30: one burst, monochrome in the area's bright tone, shorter than 800 ms", async () => {
    await celebrateStreak(30, "health");
    expect(fire).toHaveBeenCalledTimes(1);
    const options = fire.mock.calls[0][0];
    expect(options.colors).toEqual(["#5ccb8a"]);
    // ~60 frames a second: the frames it lives stay under the cap.
    expect((options.ticks / 60) * 1000).toBeLessThanOrEqual(CONFETTI_MAX_MS);
    expect(options.disableForReducedMotion).toBe(true);
  });

  test("without an area: the primary text color", async () => {
    await celebrateStreak(30, null);
    expect(fire.mock.calls[0][0].colors).toEqual(["#111111"]);
  });

  test("under reduced motion: never", async () => {
    motion(true);
    await celebrateStreak(365, "health");
    expect(fire).not.toHaveBeenCalled();
  });

  test("a failing library never throws", async () => {
    fire.mockRejectedValue(new Error("no canvas"));
    await expect(celebrateStreak(30, "health")).resolves.toBeUndefined();
  });
});
