import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DURATION, EASE, STAGGER } from "@/lib/motion";

// The numbers of `src/lib/motion/tokens.ts` mirror the synced CSS tokens: when Claude Design
// changes one and the sync lands, this fails until the mirror follows.
const CSS = readFileSync("src/design-system/styles/tokens/motion.css", "utf8");
const root = CSS.slice(0, CSS.indexOf("@media"));
const variable = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(root)?.[1]?.trim();

describe("motion tokens mirror the design system", () => {
  it("durations match --duration-* (ms to seconds)", () => {
    const mismatches: string[] = [];
    for (const [name, seconds] of Object.entries(DURATION)) {
      const css = variable(`duration-${name}`);
      // `hover` and `state` exist in CSS too; every key must exist there.
      if (css === undefined) mismatches.push(`${name}: missing in motion.css`);
      else if (Number.parseFloat(css) / 1000 !== seconds) mismatches.push(`${name}: ${css}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("easings match --ease-*", () => {
    const mismatches: string[] = [];
    for (const [name, points] of Object.entries(EASE)) {
      const css = variable(`ease-${name}`);
      const expected = `cubic-bezier(${points.join(", ")})`;
      if (css !== expected) mismatches.push(`${name}: ${css} ≠ ${expected}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("the stagger matches --stagger", () => {
    expect(Number.parseFloat(variable("stagger") ?? "NaN") / 1000).toBe(STAGGER);
  });
});
