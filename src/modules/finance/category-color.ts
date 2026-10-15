// The accent of a category: one of eight CSS variables (`--cat-1…8`, overrides.css), chosen by a
// `color_slot` stored on the category (finance-motion M3). Assigned automatically, never picked.

/** The slot a category without one shows ("Otros", and "Sin categoría"). */
export const OTHER_SLOT = 8;
const SLOTS = 8;

/** The slot to draw: 1…8, anything else (null, absent, out of range) is "Otros". */
export const slotOf = (colorSlot: number | null | undefined): number =>
  Number.isInteger(colorSlot) && colorSlot! >= 1 && colorSlot! <= SLOTS ? colorSlot! : OTHER_SLOT;

/**
 * The slot for a new category: the first one no visible category uses; with all eight taken, the
 * least used one (the lowest on a tie), so colors repeat in order. `used` are the slots of the
 * visible categories (null ones count as none).
 */
export function nextFreeSlot(used: readonly (number | null)[]): number {
  const counts = Array.from({ length: SLOTS }, () => 0);
  for (const slot of used) if (slot !== null && slot >= 1 && slot <= SLOTS) counts[slot - 1] += 1;
  return counts.indexOf(Math.min(...counts)) + 1;
}

/** The `--_cat` custom property a dot, a segment or a row line reads. */
export const categoryStyle = (colorSlot: number | null | undefined) =>
  ({ "--_cat": `var(--cat-${slotOf(colorSlot)})` }) as React.CSSProperties;
