"use client";

import { useEffect, useState } from "react";
import { cn } from "../cn";
import { markEntered, useEntryPending } from "./entry";

type CascadeProps = {
  /** Position in the cascade: block 0 appears first. */
  index: number;
  className?: string;
  /** Data attributes of the element (tests and E2E hooks that lived on the block). */
  attrs?: Record<`data-${string}`, string>;
  children: React.ReactNode;
};

/**
 * A block of the entry cascade: the first time the app opens in a tab it rises and fades in (the
 * `.bo-cascade` animation in extensions.css, one step per `index`); later screens in the same tab
 * appear as they are. It is CSS, so it plays from the first paint of the server HTML without
 * waiting for hydration, and it needs no `MotionProvider`. Whether it animates is decided once, at
 * mount (the server always says yes): the element never changes type or class afterwards, and
 * the first block to mount closes the entry for the screens that come later.
 */
export function Cascade({ index, className, attrs, children }: CascadeProps) {
  const [entering] = useState(useEntryPending());
  useEffect(() => {
    markEntered();
  }, []);
  return (
    <div
      className={cn(entering && "bo-cascade", className)}
      style={entering ? ({ "--cascade-index": index } as React.CSSProperties) : undefined}
      {...attrs}
    >
      {children}
    </div>
  );
}
