import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AREA_COLORS } from "@/design-system";

const stylesDir = path.join(process.cwd(), "src/design-system/styles");
const css = readFileSync(path.join(stylesDir, "tokens/colors.css"), "utf8");
// Local fixes (overrides.css) apply on top of the Claude Design tokens.
const overrides = readFileSync(path.join(stylesDir, "overrides.css"), "utf8");

/** Collects `--name: value;` declarations inside the first block whose selector matches. */
function readBlock(selector: RegExp, source = css): Record<string, string> {
  const match = source.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Block not found: ${selector}`);
  const vars: Record<string, string> = {};
  for (const [, name, value] of match[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars[name] = value.trim();
  }
  return vars;
}

// The first :root block holds the primitives (grays, signal, LCD, area tones).
const primitives = readBlock(/:root/);
const themes = {
  dark: readBlock(/:root,\s*\[data-theme="dark"\]/),
  light: {
    ...readBlock(/\[data-theme="light"\]/),
    ...readBlock(/\[data-theme="light"\]/, overrides),
  },
};

/** Resolves `var(--x)` chains down to a hex color within one theme. */
function resolve(vars: Record<string, string>, name: string): string {
  let value = vars[name] ?? primitives[name];
  for (let depth = 0; value?.startsWith("var("); depth++) {
    if (depth > 5) throw new Error(`var() cycle at --${name}`);
    const ref = value.slice(6, -1);
    value = vars[ref] ?? primitives[ref];
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--${name} is not a hex color`);
  return value;
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

// [foreground, background, minimum]. 4.5 = WCAG AA text, 3 = UI components and focus.
const PAIRS: [string, string, number][] = [
  ["color-text", "color-bg", 4.5],
  ["color-text", "color-surface", 4.5],
  ["color-text", "color-key", 4.5],
  ["color-text", "color-panel", 4.5],
  ["color-text", "color-sidebar", 4.5],
  ["color-text-secondary", "color-bg", 4.5],
  ["color-text-secondary", "color-surface", 4.5],
  ["color-text-secondary", "color-key", 4.5],
  ["color-text-secondary", "color-panel", 4.5],
  ["color-text-secondary", "color-sidebar", 4.5],
  ["color-placeholder", "color-input-bg", 4.5],
  ["color-signal-text", "color-bg", 4.5],
  ["color-signal-text", "color-surface", 4.5],
  ["color-on-signal", "color-signal", 4.5],
  ["color-on-signal", "color-signal-hover", 4.5],
  ["color-on-key-on", "color-key-on", 4.5],
  ["color-kbd-text", "color-kbd-bg", 4.5],
  ["color-tooltip-text", "color-tooltip-bg", 4.5],
  ["color-lcd-text", "color-lcd-bg", 4.5],
  ["color-lcd-text-secondary", "color-lcd-bg", 4.5],
  ["color-lcd-signal", "color-lcd-bg", 4.5],
  ["color-border-control", "color-bg", 3],
  ["color-border-control", "color-input-bg", 3],
  ["color-focus", "color-bg", 3],
];

describe.each(Object.entries(themes))("%s theme", (_theme, vars) => {
  test.each(PAIRS)("%s on %s ≥ %s:1", (fg, bg, min) => {
    expect(contrast(resolve(vars, fg), resolve(vars, bg))).toBeGreaterThanOrEqual(min);
  });

  test.each(AREA_COLORS)("area %s ≥ 4.5:1 on the background", (area) => {
    expect(
      contrast(resolve(vars, `area-${area}`), resolve(vars, "color-bg")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test.each(AREA_COLORS)("area %s inverse ≥ 4.5:1 on an activated key", (area) => {
    expect(
      contrast(resolve(vars, `area-${area}-inverse`), resolve(vars, "color-key-on")),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
