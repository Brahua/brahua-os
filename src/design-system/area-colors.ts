/**
 * Life-area colors. Each color has two tones defined in tokens.css:
 * - `led`: bright tone, readable on dark surfaces.
 * - `ink`: dark tone, readable on light surfaces (chalk keys, light theme).
 * Red is intentionally absent: failing a habit must never read as an error.
 */
export const AREA_COLORS = [
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
  "orange",
  "lime",
] as const;

export type AreaColor = (typeof AREA_COLORS)[number];

export type AreaTone = "led" | "ink";

/** CSS custom property for an area tone, e.g. `var(--color-area-blue-led)`. */
export function areaColorVar(color: AreaColor, tone: AreaTone): string {
  return `var(--color-area-${color}-${tone})`;
}
