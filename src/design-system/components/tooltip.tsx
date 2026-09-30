"use client";

import { cloneElement, isValidElement, useId } from "react";
import { cn } from "@/lib/cn";
import { Kbd } from "./kbd";

export type TooltipPlacement = "right" | "top" | "bottom";

type TooltipProps = {
  label: string;
  shortcut?: string | string[];
  placement?: TooltipPlacement;
  /** Force it open (documentation). */
  open?: boolean;
  /**
   * The trigger already carries the same text as its accessible name (e.g. IconKey's aria-label):
   * hide the tooltip from assistive tech instead of describing the trigger with duplicate text.
   */
  decorative?: boolean;
  className?: string;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
};

/**
 * Name + shortcut of a control (design system `Tooltip`). CSS-driven: appears after 300 ms of
 * hover, or immediately on keyboard focus.
 */
export function Tooltip({
  label,
  shortcut,
  placement = "right",
  open,
  decorative = false,
  className,
  children,
}: TooltipProps) {
  const id = useId();
  const trigger =
    !decorative && isValidElement(children)
      ? cloneElement(children, { "aria-describedby": id })
      : children;

  return (
    <span className={cn("bo-tooltip-anchor", open && "is-open", className)}>
      {trigger}
      <span
        id={decorative ? undefined : id}
        role={decorative ? undefined : "tooltip"}
        aria-hidden={decorative || undefined}
        className={`bo-tooltip bo-tooltip--${placement}`}
      >
        {label}
        {shortcut ? <Kbd keys={shortcut} tone="tooltip" /> : null}
      </span>
    </span>
  );
}
