import type { Transition, Variants } from "motion/react";
import { DURATION, EASE, SCREEN, STAGGER, TRAVEL } from "./tokens";

// Shared variants of the contract (the entry cascade is CSS: `Cascade`). Each moves only `opacity` and `transform` (plus a stroke's
// `pathLength` and a collapsing row's height). The reduced version is not here: `MotionProvider`
// sets `reducedMotion="user"`, so Motion keeps the opacity and skips the transforms by itself.

const out = { ease: EASE.out } as const;
const standard = { ease: EASE.standard } as const;

/** Content that follows an arrow: `custom` is the direction (1 comes from the right, -1 from the left). */
export const slideSwap = {
  leaving: (direction: 1 | -1 = 1) => ({
    opacity: 0.4,
    x: -TRAVEL * direction,
    transition: { duration: SCREEN.swapOut, ...standard },
  }),
  entering: (direction: 1 | -1 = 1) => ({ opacity: 0.4, x: TRAVEL * direction }),
  settled: {
    opacity: 1,
    x: 0,
    transition: { duration: SCREEN.swapIn, ...out },
  },
} satisfies Variants;

/** Two panels that trade places (sections): the one that arrives rises a few pixels. */
export const crossFade = {
  hidden: { opacity: 0, y: SCREEN.tabTravel },
  shown: { opacity: 1, y: 0, transition: { duration: SCREEN.tab, ...out } },
} satisfies Variants;

/** A row that leaves (or arrives) by folding its height; `overflow: hidden` on the row. */
export const collapse = {
  open: { opacity: 1, height: "auto", transition: { duration: SCREEN.rowCollapse, ...standard } },
  closed: { opacity: 0, height: 0, transition: { duration: SCREEN.rowCollapse, ...standard } },
} satisfies Variants;

/** A chip that appears with a small overshoot and leaves quickly. */
export const pop = {
  hidden: { opacity: 0, scale: 0.88, transition: { duration: DURATION.hover + 0.03, ...out } },
  shown: { opacity: 1, scale: 1, transition: { duration: DURATION.panel, ease: EASE.pop } },
} satisfies Variants;

/** A stroke that draws itself (SVG `path`): `pathLength` goes from 0 to 1. */
export const drawPath = {
  hidden: { pathLength: 0, opacity: 0 },
  shown: (delay: number = 0) => ({
    pathLength: 1,
    opacity: 1,
    transition: { duration: SCREEN.draw, delay, ...out },
  }),
} satisfies Variants;

/** A highlight that fades out: `custom` is how long it stays lit before it goes (seconds). */
export const flash = {
  lit: { opacity: 1 },
  off: (hold: number = 0.5) => ({
    opacity: 0,
    transition: { duration: DURATION.celebrate, delay: hold, ...standard },
  }),
} satisfies Variants;

/** How a number-like value settles (bars, widths): spring-free, so it never overshoots a total. */
export const settle: Transition = { duration: SCREEN.settle, ...out };

/** The delay of the nth segment of something that draws segment by segment. */
export const segmentDelay = (index: number) => index * SCREEN.drawStep;

export { STAGGER };
