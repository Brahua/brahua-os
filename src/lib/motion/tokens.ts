// The motion language as numbers, for Motion and `animate()` (they take seconds and cubic-bezier
// arrays, not CSS variables). The first group mirrors `design-system/styles/tokens/motion.css`
// (synced from Claude Design: never edit it here); `tests/lib/motion-tokens.test.ts` fails when
// the two drift. The second group is the screen-level timing the Finanzas design fixes and that
// has no CSS token yet (PENDING UPSTREAM: ask Claude Design to promote them to tokens).

/** Seconds. Mirrors `--duration-*`. */
export const DURATION = {
  press: 0.09,
  hover: 0.12,
  state: 0.2,
  sidebar: 0.24,
  panel: 0.32,
  sheet: 0.38,
  celebrate: 1,
  switch: 0.2,
} as const;

/** Cubic-bezier control points. Mirrors `--ease-*`. */
export const EASE = {
  press: [0.3, 0, 0, 1],
  standard: [0.2, 0, 0, 1],
  out: [0.16, 1, 0.3, 1],
  drawer: [0.32, 0.72, 0, 1],
  pop: [0.34, 1.56, 0.64, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Seconds between two siblings of a cascade. Mirrors `--stagger` (24 ms). */
export const STAGGER = 0.024;

/** Pixels an element may travel while it enters or leaves. Finanzas uses 8; the token says 3. */
export const TRAVEL = 8;

/** Seconds. Timing of Finanzas that the design fixes and the CSS tokens don't name yet. */
export const SCREEN = {
  /** A block of the entry cascade appears after this many staggers per position (3 × 24 ms). */
  cascadeStep: STAGGER * 3,
  /** The content leaves (towards the arrow) while the next month loads. */
  swapOut: 0.12,
  /** The next month's content arrives. */
  swapIn: 0.24,
  /** Bars and the line draw when the screen first appears. */
  draw: 0.9,
  /** One segment of a bar starts this long after the previous one. */
  drawStep: 0.06,
  /** A bar or a number settles on its new value (month, filter, edit). */
  settle: 0.52,
  /** The sections' indicator and the cross of their content. */
  tab: 0.24,
  /** Content that crosses between sections travels this many pixels. */
  tabTravel: 6,
  /** A row leaves a list (filter, delete). */
  rowOut: 0.26,
  /** A row's height collapses on delete. */
  rowCollapse: 0.28,
} as const;

/** An `EASE` entry as the mutable tuple that `animate()` takes. */
export function bezier(
  ease: readonly [number, number, number, number],
): [number, number, number, number] {
  return [ease[0], ease[1], ease[2], ease[3]];
}
