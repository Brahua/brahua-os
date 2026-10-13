"use client";

import { useEffect } from "react";
import { celebrate } from "@/lib/celebrate";

/**
 * What the closing screen does on arrival, once: focus goes to its heading (the page changed, the
 * focused key is gone) and the discreet confetti of `core` plays (monochrome, never under reduced
 * motion: `celebrate` checks the preference itself). Renders nothing; it keeps no timers.
 */
export function ClosingEffects({ headingId }: { headingId: string }) {
  useEffect(() => {
    document.getElementById(headingId)?.focus({ preventScroll: true });
    void celebrate(null);
  }, [headingId]);
  return null;
}
