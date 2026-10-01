import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { BRAND_COLORS } from "@/design-system/brand-colors";

const COLORS_CSS = readFileSync(
  path.resolve(__dirname, "../../src/design-system/styles/tokens/colors.css"),
  "utf8",
);

test.each(Object.entries(BRAND_COLORS))(
  "%s equals its token in colors.css",
  (_, { token, hex }) => {
    const declared = COLORS_CSS.match(new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6});`))?.[1];
    expect(declared, token).toBeDefined();
    expect(hex.toUpperCase()).toBe(declared!.toUpperCase());
  },
);
