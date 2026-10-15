"use client";

import { ChevronRight } from "lucide-react";
import { Icon } from "@/design-system";

type MetricCardProps = {
  label: string;
  /** The figure (decorative: `spoken` says it). */
  value: React.ReactNode;
  /** What a screen reader hears instead of the label and the figure. */
  spoken: string;
  /** A line under the figure. */
  hint?: React.ReactNode;
  /** A slot under the hint (the sparkline of «Gastado», M4). */
  children?: React.ReactNode;
  /** With it the card is a button (it shows another section); without, a plain block. */
  onClick?: (element: HTMLButtonElement) => void;
  attr?: string;
};

/** A summary card: a mono label, a big figure, a hint. The element never changes during its life. */
export function MetricCard({
  label,
  value,
  spoken,
  hint,
  children,
  onClick,
  attr,
}: MetricCardProps) {
  const body = (
    <>
      <span className="bo-stat__label flex items-center justify-between" aria-hidden>
        {label}
        {onClick ? <Icon icon={ChevronRight} size="sm" /> : null}
      </span>
      <span className="bo-metric-card__value" aria-hidden>
        {value}
      </span>
      {hint ? (
        <span className="bo-text-body-sm text-text-secondary" aria-hidden>
          {hint}
        </span>
      ) : null}
      {children}
    </>
  );
  const data = attr ? { [attr]: "" } : undefined;
  if (onClick) {
    return (
      <button
        type="button"
        className="bo-card bo-metric-card"
        aria-label={spoken}
        onClick={(event) => onClick(event.currentTarget)}
        {...data}
      >
        {body}
      </button>
    );
  }
  return (
    <div className="bo-card bo-metric-card" role="group" aria-label={spoken} {...data}>
      {body}
    </div>
  );
}
