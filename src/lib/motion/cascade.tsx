"use client";

import { useEffect, useState } from "react";
import * as m from "motion/react-m";
import { markEntered, useEntryPending } from "./entry";
import { useMotionEnabled } from "./provider";
import { cascade } from "./variants";

type CascadeProps = {
  /** Position in the cascade: block 0 appears first. */
  index: number;
  className?: string;
  /** Data attributes of the element (tests and E2E hooks that lived on the block). */
  attrs?: Record<`data-${string}`, string>;
  children: React.ReactNode;
};

/**
 * A block of the entry cascade. Without a `MotionProvider`, or once the cascade has played in
 * this tab, it is a plain `div`. The first block to mount closes the entry for later screens.
 */
export function Cascade({ index, className, attrs, children }: CascadeProps) {
  const enabled = useMotionEnabled();
  // Decided once, when the block mounts: the element must keep its type for its whole life (a
  // `div` that turned into an animated one, or back, would remount its children and cut the
  // animation) even though the first block closes the entry for the ones that come later.
  const [pending] = useState(useEntryPending());
  useEffect(() => {
    if (enabled) markEntered();
  }, [enabled]);
  if (!enabled || !pending)
    return (
      <div className={className} {...attrs}>
        {children}
      </div>
    );
  return (
    <m.div
      className={className}
      {...attrs}
      // E2E waits for it to finish (`animationsSettled`): Motion moves it with frames, not CSS.
      data-motion-cascade=""
      variants={cascade}
      custom={index}
      initial="hidden"
      animate="shown"
    >
      {children}
    </m.div>
  );
}
