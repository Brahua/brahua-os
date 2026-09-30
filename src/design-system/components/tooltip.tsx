"use client";

import { cloneElement, isValidElement, useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { Kbd } from "./kbd";

export type TooltipPlacement = "right" | "top" | "bottom";

type TooltipProps = {
  label: string;
  shortcut?: string | string[];
  placement?: TooltipPlacement;
  /** Force it open (documentation, or a brief hint after a tap). */
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
 *
 * WCAG 1.4.13: it stays open while the pointer moves onto it (see overrides.css), and Esc
 * dismisses it until the pointer leaves or focus moves away.
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
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const engaged = hovered || focused || open === true;

  // Esc works wherever focus is (the pointer may hover a control without focusing it).
  useEffect(() => {
    if (!engaged || dismissed) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDismissed(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [engaged, dismissed]);

  const trigger =
    !decorative && isValidElement(children)
      ? cloneElement(children, { "aria-describedby": id })
      : children;

  return (
    <span
      className={cn("bo-tooltip-anchor", open && "is-open", dismissed && "is-dismissed", className)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        if (!focused) setDismissed(false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setFocused(false);
        if (!hovered) setDismissed(false);
      }}
    >
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
