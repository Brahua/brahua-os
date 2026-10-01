import { formatStat, SegmentBar, StatNumber } from "@/design-system";
import { cn } from "@/lib/cn";
import { MILESTONES_COPY } from "../milestones-copy";
import type { Progress } from "../progress";

/**
 * Up to this many segments, one per milestone (the design system's `SegmentBar`); beyond it the
 * bar keeps this many and fills them in proportion (never all of them until every one is done),
 * so a long list doesn't shrink them to slivers. The meter's value is still done of total.
 */
export const MAX_SEGMENTS = 20;

/** Filled segments out of `segments` for the progress. */
export function filledSegments({ done, total }: Progress, segments: number): number {
  if (total <= segments) return done;
  return done === total ? segments : Math.floor((done / total) * segments);
}

type ProgressMeterProps = {
  progress: Progress;
  /** `card`: the list's compact figure; `detail`: the larger one under the project's dates. */
  variant?: "card" | "detail";
  id?: string;
  /**
   * Hidden from assistive tech when something else already says it (the card's link has it as
   * its description, so the card would read it twice).
   */
  decorative?: boolean;
  className?: string;
};

/**
 * A project's progress (SPEC-projects "Avance"): the percentage as a `StatNumber`, "N de M
 * hitos" and a `SegmentBar`, like the Claude Design pattern `ProjectCard`. One meter for
 * assistive tech: the bar carries the full name ("Avance: 60 %, 3 de 5 hitos"); the figures
 * next to it are hidden from it so they aren't read twice. Renders on the server too.
 */
export function ProgressMeter({
  progress,
  variant = "card",
  id,
  decorative = false,
  className,
}: ProgressMeterProps) {
  const { done, total, ratio } = progress;
  const segments = Math.min(total, MAX_SEGMENTS);
  const name = MILESTONES_COPY.progressName(formatStat(ratio, "percent"), done, total);
  return (
    <div
      id={id}
      className={cn("flex flex-col gap-2", className)}
      data-progress={`${done}/${total}`}
      aria-hidden={decorative || undefined}
    >
      <div className="flex items-baseline justify-between gap-3" aria-hidden>
        <StatNumber value={ratio} kind="percent" size={variant === "detail" ? "md" : "sm"} />
        <span className="bo-text-label text-text-secondary">
          {MILESTONES_COPY.progressCount(done, total)}
        </span>
      </div>
      <SegmentBar
        total={segments}
        filled={filledSegments(progress, segments)}
        size={variant === "detail" ? "lg" : "md"}
        label={name}
        // The meter's value is milestones, whatever the number of segments drawn.
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={name}
      />
    </div>
  );
}
