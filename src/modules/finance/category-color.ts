// The accent of a category: one of eight CSS variables (`--cat-1…8`, overrides.css). Until M3
// stores a slot per category, the slot is the category's position in the list it is shown in.

/** The slot (1…8) of the category at `index`; with more than eight they repeat, in order. */
export const categorySlot = (index: number) => (index % 8) + 1;

/** The `--_cat` custom property a dot or a segment reads. */
export const categoryStyle = (index: number) =>
  ({ "--_cat": `var(--cat-${categorySlot(index)})` }) as React.CSSProperties;
