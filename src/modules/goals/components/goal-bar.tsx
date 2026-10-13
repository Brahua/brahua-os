import { SegmentBar } from "@/design-system";
import { GOALS_COPY } from "../goals-copy";

/** Up to this many segments (the design system's `SegmentBar`); beyond it they fill in proportion. */
export const MAX_SEGMENTS = 20;

/** Filled segments out of `segments` for `value` of `target` (all of them only when reached). */
export function filledSegments(value: number, target: number, segments: number): number {
  if (target <= segments) return Math.min(value, target);
  if (value >= target) return segments;
  return Math.floor((Math.max(value, 0) / target) * segments);
}

type GoalBarProps = {
  title: string;
  value: number;
  target: number;
  /** "5 de 12 libros": the value the bar reads out. */
  count: string;
  size?: "md" | "lg";
};

/**
 * A goal's bar: the design system's segmented bar as a `progressbar` whose values are the goal's
 * own (`aria-valuenow` out of `aria-valuemax`), with the full sentence as its text, so the meaning
 * never rests on the fill alone (the figures sit next to it, visible).
 */
export function GoalBar({ title, value, target, count, size = "md" }: GoalBarProps) {
  const segments = Math.min(target, MAX_SEGMENTS);
  return (
    <SegmentBar
      role="progressbar"
      total={segments}
      filled={filledSegments(value, target, segments)}
      size={size}
      label={GOALS_COPY.barName(title, count)}
      aria-valuemin={0}
      aria-valuemax={target}
      aria-valuenow={Math.min(Math.max(value, 0), target)}
      aria-valuetext={count}
    />
  );
}
