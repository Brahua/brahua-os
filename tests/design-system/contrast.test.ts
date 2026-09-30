import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AREA_COLORS } from "@/design-system";

const css = readFileSync(path.join(process.cwd(), "src/design-system/tokens.css"), "utf8");

/** Collects `--name: #hex;` declarations inside the first block whose selector matches. */
function readBlock(selector: RegExp): Record<string, string> {
  const match = css.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Block not found: ${selector}`);
  const vars: Record<string, string> = {};
  for (const [, name, value] of match[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    vars[name] = value;
  }
  return vars;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const primitives = readBlock(/@theme static/);
const themes = {
  dark: readBlock(/:root,\s*\[data-theme="dark"\]/),
  light: readBlock(/\[data-theme="light"\]/),
};

// [foreground, background, minimum ratio]. 4.5 = WCAG AA body text.
const TEXT_PAIRS: [string, string, number][] = [
  ["text", "bg", 4.5],
  ["text", "surface", 4.5],
  ["text", "panel", 4.5],
  ["text", "sidebar", 4.5],
  ["text-muted", "bg", 4.5],
  ["text-muted", "surface", 4.5],
  ["text-muted", "panel", 4.5],
  ["text-muted", "sidebar", 4.5],
  ["signal-text", "bg", 4.5],
  ["signal-text", "surface", 4.5],
  ["on-signal", "signal", 4.5],
  ["on-signal", "signal-hover", 4.5],
  ["bg", "surface-pressed", 4.5],
  ["kbd-text", "kbd-bg", 4.5],
  ["tooltip-text", "tooltip-bg", 4.5],
  ["lcd-text", "lcd-bg", 4.5],
  ["lcd-signal", "lcd-bg", 4.5],
];

describe.each(Object.entries(themes))("%s theme", (_name, vars) => {
  test.each(TEXT_PAIRS)("%s on %s ≥ %s:1", (fg, bg, min) => {
    expect(vars[fg], `missing --${fg}`).toBeDefined();
    expect(vars[bg], `missing --${bg}`).toBeDefined();
    expect(contrast(vars[fg], vars[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe("area colors", () => {
  const darkBg = themes.dark.bg;
  const chalk = primitives["color-gray-100"];

  test.each(AREA_COLORS)("%s has led and ink tones", (color) => {
    expect(primitives[`color-area-${color}-led`]).toBeDefined();
    expect(primitives[`color-area-${color}-ink`]).toBeDefined();
  });

  test.each(AREA_COLORS)("%s led ≥ 4.5:1 on dark background", (color) => {
    expect(contrast(primitives[`color-area-${color}-led`], darkBg)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(AREA_COLORS)("%s ink ≥ 4.5:1 on chalk and white", (color) => {
    const ink = primitives[`color-area-${color}-ink`];
    expect(contrast(ink, chalk)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, themes.light.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
