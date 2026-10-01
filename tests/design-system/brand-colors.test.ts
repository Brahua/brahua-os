import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { BRAND_COLORS, type BrandColor } from "@/design-system/brand-colors";

const TOKENS_DIR = path.resolve(__dirname, "../../src/design-system/styles/tokens");
const COLORS_CSS = readFileSync(path.join(TOKENS_DIR, "colors.css"), "utf8");
const SHADOWS_CSS = readFileSync(path.join(TOKENS_DIR, "shadows.css"), "utf8");

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The declarations of the `[data-theme="…"]` rule (the dark one also applies to `:root`). */
function themeBlock(css: string, theme: "dark" | "light"): string {
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\] \\{([^}]*)\\}`))?.[1];
  if (!block) throw new Error(`No [data-theme="${theme}"] rule`);
  return block;
}

/** A custom property's value, matched on a whole declaration line (`--gray-75` ≠ `--gray-750`). */
function declaration(css: string, property: string): string | undefined {
  return css.match(new RegExp(`^\\s*${escape(property)}:\\s*([^;]+);\\s*$`, "m"))?.[1].trim();
}

test.each(Object.entries(BRAND_COLORS))(
  "%s equals its token in colors.css",
  (_, { token, hex }) => {
    const declared = declaration(COLORS_CSS, token);
    expect(declared, token).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(hex.toUpperCase()).toBe(declared!.toUpperCase());
  },
);

// What each brand color stands for: if the theme starts using another primitive for the role,
// the manifest, the metas and the icons must follow.
const ROLES: Record<
  BrandColor,
  { css: string; theme: "dark" | "light"; property: string; contains: string }
> = {
  darkBackground: {
    css: COLORS_CSS,
    theme: "dark",
    property: "--color-bg",
    contains: "var(--gray-925)",
  },
  lightBackground: {
    css: COLORS_CSS,
    theme: "light",
    property: "--color-bg",
    contains: "var(--gray-75)",
  },
  key: { css: COLORS_CSS, theme: "dark", property: "--color-key", contains: "var(--gray-850)" },
  ink: { css: COLORS_CSS, theme: "dark", property: "--color-text", contains: "var(--gray-75)" },
  signal: {
    css: COLORS_CSS,
    theme: "dark",
    property: "--color-signal",
    contains: "var(--signal-500)",
  },
  keyEdge: {
    css: SHADOWS_CSS,
    theme: "dark",
    property: "--shadow-key",
    contains: "inset 0 -4px 0 var(--gray-1000)",
  },
  keyHighlight: {
    css: SHADOWS_CSS,
    theme: "dark",
    property: "--shadow-key",
    contains: "inset 0 1px 0 var(--gray-750)",
  },
};

test.each(Object.entries(ROLES))("%s plays its role in the theme", (color, role) => {
  const value = declaration(themeBlock(role.css, role.theme), role.property);
  expect(value, `${role.property} (${role.theme})`).toBeDefined();
  if (role.property.startsWith("--color-")) {
    // A color role points at exactly one primitive, and it is this brand color's token.
    expect(value).toBe(role.contains);
    expect(role.contains).toBe(`var(${BRAND_COLORS[color as BrandColor].token})`);
  } else {
    expect(value).toContain(role.contains);
    expect(role.contains).toContain(`var(${BRAND_COLORS[color as BrandColor].token})`);
  }
});

test("every brand color has a role", () => {
  expect(Object.keys(ROLES).sort()).toEqual(Object.keys(BRAND_COLORS).sort());
});
