"use client";

import NumberFlow from "@number-flow/react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import {
  formatStat,
  STAT_LOCALE,
  statFormat,
  type StatCurrency,
  type StatKind,
} from "../stat-format";

const statVariants = cva("font-mono tabular-nums", {
  variants: {
    size: {
      data: "text-data",
      "title-sm": "text-title-sm",
      title: "text-title",
      display: "text-display",
    },
  },
  defaultVariants: { size: "data" },
});

type StatNumberProps = VariantProps<typeof statVariants> & {
  value: number;
  kind?: StatKind;
  currency?: StatCurrency;
  className?: string;
};

/**
 * Animated number (NumberFlow). Digits roll when the value changes;
 * with prefers-reduced-motion the value just swaps.
 * NumberFlow exposes each digit separately to assistive tech, so the animation is hidden
 * and screen readers get the formatted value as one string ("S/ 2,340").
 */
export function StatNumber({ value, kind = "number", currency, size, className }: StatNumberProps) {
  return (
    <span className={cn(statVariants({ size }), className)}>
      {/* aria-hidden on NumberFlow itself is not forwarded to its host element. */}
      <span aria-hidden>
        <NumberFlow
          value={value}
          locales={STAT_LOCALE}
          format={statFormat(kind, currency)}
          respectMotionPreference
        />
      </span>
      <span className="sr-only">{formatStat(value, kind, currency)}</span>
    </span>
  );
}
