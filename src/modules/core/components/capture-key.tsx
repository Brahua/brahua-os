"use client";

import { useEffect, useState } from "react";
import { Tooltip, type TooltipPlacement } from "@/design-system";
import { cn } from "@/lib/cn";
import { NAV_COPY } from "../copy";

/** How long a tap on the unavailable key shows its explanation. */
const HINT_MS = 2000;

type CaptureKeyProps = {
  /** Opens quick capture. Without it the key is marked unavailable (quick capture isn't built yet). */
  onCapture?: () => void;
  /** Show the "C" shortcut (only when capture is available and shortcuts are on). */
  shortcut?: boolean;
  placement: TooltipPlacement;
  /** Classes for the key itself. */
  className?: string;
  /** Classes for the wrapper, which is what the parent lays out (grid cell, flex item). */
  anchorClassName?: string;
  children: React.ReactNode;
};

/**
 * The orange capture key of the navigation. Until quick capture exists it stays in place (so the
 * layout doesn't change when it arrives) but is `aria-disabled`, still reachable with Tab, and
 * its tooltip explains why — read as the button's description. Touch screens have no hover, so
 * tapping it shows the explanation for a moment.
 */
export function CaptureKey({
  onCapture,
  shortcut = false,
  placement,
  className,
  anchorClassName,
  children,
}: CaptureKeyProps) {
  const available = onCapture !== undefined;
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(false), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const showShortcut = available && shortcut;
  return (
    <Tooltip
      label={available ? NAV_COPY.capture : NAV_COPY.captureUnavailable}
      shortcut={showShortcut ? "C" : undefined}
      placement={placement}
      open={hint || undefined}
      className={anchorClassName}
      // Available: the tooltip repeats the name. Unavailable: it is the explanation.
      decorative={available}
    >
      <button
        type="button"
        className={cn("bo-key bo-key--signal", !available && "is-disabled", className)}
        aria-label={NAV_COPY.capture}
        aria-disabled={available ? undefined : true}
        aria-keyshortcuts={showShortcut ? "C" : undefined}
        onClick={available ? onCapture : () => setHint(true)}
      >
        {children}
      </button>
    </Tooltip>
  );
}
