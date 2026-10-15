"use client";

// A list row that folds its height when it leaves and unfolds when it arrives after the screen has
// hydrated (finance-motion M5): filtering, deleting, undoing and registering. Without the motion
// contract (tests, no `MotionProvider`) it is a plain `li`. Wrap the list's rows in
// `<AnimatePresence initial={false}>`: the first render never animates and the server HTML is
// always visible.
import * as m from "motion/react-m";
import { collapse, useMotionEnabled } from "@/lib/motion";

export function PresenceItem({ children }: { children: React.ReactNode }) {
  const enabled = useMotionEnabled();
  if (!enabled) return <li>{children}</li>;
  return (
    <m.li
      variants={collapse}
      initial="closed"
      animate="open"
      exit="closed"
      // The fold needs the row's content clipped; the focus ring is drawn inside the row.
      style={{ overflow: "hidden" }}
    >
      {children}
    </m.li>
  );
}
