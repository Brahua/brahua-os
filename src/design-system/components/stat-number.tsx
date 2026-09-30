"use client";

import NumberFlow from "@number-flow/react";
import { cn } from "@/lib/cn";
import {
  formatStat,
  STAT_LOCALE,
  statFormat,
  type StatCurrency,
  type StatKind,
} from "../stat-format";

type StatNumberProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** A number animates (digits roll) and is formatted for es-PE; a string is shown as is. */
  value: number | string;
  kind?: StatKind;
  currency?: StatCurrency;
  unit?: string;
  label?: string;
  /** sm 15 px · md 26 px · lg 40 px */
  size?: "sm" | "md" | "lg";
};

/**
 * Highlighted figure in IBM Plex Mono tabular (design system `StatNumber`).
 * NumberFlow exposes each digit separately to assistive tech, so the animation is hidden and
 * screen readers get the formatted value as one string ("S/ 2,340").
 */
export function StatNumber({
  value,
  kind = "number",
  currency,
  unit,
  label,
  size = "md",
  className,
  ...props
}: StatNumberProps) {
  return (
    <span className={cn("bo-stat", size !== "md" && `bo-stat--${size}`, className)} {...props}>
      <span className="bo-stat__value">
        {typeof value === "number" ? (
          <>
            <span aria-hidden>
              <NumberFlow
                value={value}
                locales={STAT_LOCALE}
                format={statFormat(kind, currency)}
                respectMotionPreference
              />
            </span>
            <span className="sr-only">{formatStat(value, kind, currency)}</span>
          </>
        ) : (
          value
        )}
        {unit ? <span className="bo-stat__unit">{unit}</span> : null}
      </span>
      {label ? <span className="bo-stat__label">{label}</span> : null}
    </span>
  );
}
