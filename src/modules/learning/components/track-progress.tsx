import { SegmentBar } from "@/design-system";
import { cn } from "@/lib/cn";
import { LEARNING_COPY as COPY } from "../learning-copy";

/** Up to this many segments; beyond it the bar keeps this many and fills them in proportion. */
export const MAX_SEGMENTS = 20;

/** Filled segments out of `segments` (all of them only when every step is done). */
export function filledSegments(done: number, total: number, segments: number): number {
  if (total <= segments) return done;
  return done === total ? segments : Math.floor((done / total) * segments);
}

type TrackProgressProps = {
  title: string;
  done: number;
  total: number;
  size?: "md" | "lg";
  className?: string;
};

/**
 * A track's syllabus progress: the design system's segmented bar with «13 de 40» next to it. One
 * meter for assistive tech (the full name on the bar; the visible figures are hidden from it).
 * Renders on the server too.
 */
export function TrackProgress({ title, done, total, size = "md", className }: TrackProgressProps) {
  const segments = Math.min(total, MAX_SEGMENTS);
  const name = COPY.stepsName(title, done, total);
  return (
    <div
      className={cn("flex min-w-0 items-center gap-3", className)}
      data-track-progress={`${done}/${total}`}
    >
      <SegmentBar
        className="min-w-0 flex-1"
        total={segments}
        filled={filledSegments(done, total, segments)}
        size={size}
        label={name}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={name}
      />
      <span aria-hidden className="bo-text-label shrink-0 text-text-secondary tabular-nums">
        {COPY.stepsCount(done, total)}
      </span>
    </div>
  );
}
