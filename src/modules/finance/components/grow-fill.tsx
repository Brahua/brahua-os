"use client";

// The filled part of a summary bar. With the motion contract it grows from nothing the first
// time the screen appears (segment by segment) and settles on its new width when a month or an
// edit changes it; without it (tests, no `MotionProvider`) it is the plain bar it always was.
import * as m from "motion/react-m";
import { useEntryPending, useMotionEnabled, useValueTransition } from "@/lib/motion";

type GrowFillProps = {
  /** 0…1 of the bar's track. */
  share: number;
  /** Position among its siblings: the draw is staggered. */
  index?: number;
};

export function GrowFill({ share, index = 0 }: GrowFillProps) {
  const enabled = useMotionEnabled();
  const entering = useEntryPending();
  const transition = useValueTransition(entering, index);
  const width = `${(share * 100).toFixed(2)}%`;
  if (!enabled) return <span className="bo-summary-bar__fill" style={{ width }} />;
  return (
    <m.span
      className="bo-summary-bar__fill"
      initial={entering ? { width: "0%" } : false}
      animate={{ width }}
      transition={transition}
    />
  );
}
