"use client";

import { Tooltip, type TooltipPlacement } from "@/design-system";
import { cn } from "@/lib/cn";
import { NAV_COPY } from "../copy";

type CaptureKeyProps = {
  /** Opens quick capture. Without it the key is marked unavailable (quick capture isn't built yet). */
  onCapture?: () => void;
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
 * its tooltip explains why — read as the button's description.
 */
export function CaptureKey({
  onCapture,
  placement,
  className,
  anchorClassName,
  children,
}: CaptureKeyProps) {
  const available = onCapture !== undefined;
  return (
    <Tooltip
      label={available ? NAV_COPY.capture : NAV_COPY.captureUnavailable}
      shortcut={available ? "C" : undefined}
      placement={placement}
      className={anchorClassName}
      // Available: the tooltip repeats the name. Unavailable: it is the explanation.
      decorative={available}
    >
      <button
        type="button"
        className={cn("bo-key bo-key--signal", !available && "is-disabled", className)}
        aria-label={NAV_COPY.capture}
        aria-disabled={available ? undefined : true}
        aria-keyshortcuts={available ? "C" : undefined}
        onClick={onCapture}
      >
        {children}
      </button>
    </Tooltip>
  );
}
