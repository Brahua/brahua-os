/**
 * Token values as hex, for the places that cannot read CSS variables: the web manifest, the
 * theme-color metas and the app icons (SPEC-core "PWA"). Each one names its token in
 * styles/tokens/colors.css; tests/design-system/brand-colors.test.ts keeps them equal.
 */
export const BRAND_COLORS = {
  /** Page background in the dark theme (the default). */
  darkBackground: { token: "--gray-925", hex: "#0A0A0A" },
  /** Page background in the light theme. */
  lightBackground: { token: "--gray-75", hex: "#F2F2F0" },
  /** A key's face in the dark theme (--color-key). */
  key: { token: "--gray-850", hex: "#161616" },
  /** A key's bottom edge (--shadow-key). */
  keyEdge: { token: "--gray-1000", hex: "#000000" },
  /** A key's top highlight (--shadow-key). */
  keyHighlight: { token: "--gray-750", hex: "#2A2A2A" },
  /** Text on dark (--color-text). */
  ink: { token: "--gray-75", hex: "#F2F2F0" },
  signal: { token: "--signal-500", hex: "#FF4A1C" },
} as const;

export type BrandColor = keyof typeof BRAND_COLORS;

/** The hex value of a brand color. */
export const brandHex = (color: BrandColor) => BRAND_COLORS[color].hex;
