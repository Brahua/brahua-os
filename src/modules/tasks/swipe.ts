// The rules of the row swipe ("Mañana" by dragging to the left), pure and client-safe.

/** How far (px) a row is dragged to the left before releasing it postpones. */
export const SWIPE_THRESHOLD = 96;
/** A quick flick counts too (px/s), once it has moved at least `SWIPE_MIN_FLICK`. */
export const SWIPE_VELOCITY = 600;
export const SWIPE_MIN_FLICK = 48;
/** How long the row takes to fade out before it leaves (s): inside the 100 ms budget. */
export const LEAVE_FADE_SECONDS = 0.09;

/**
 * Whether releasing a drag postpones: it went left at least `SWIPE_THRESHOLD`, or it was a quick
 * flick (`SWIPE_VELOCITY` px/s to the left) that moved at least `SWIPE_MIN_FLICK`. Anything to the
 * right never does.
 */
export function swipeDecision(offsetX: number, velocityX: number): boolean {
  if (offsetX <= -SWIPE_THRESHOLD) return true;
  return velocityX <= -SWIPE_VELOCITY && offsetX <= -SWIPE_MIN_FLICK;
}
