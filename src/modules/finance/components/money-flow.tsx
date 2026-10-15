"use client";

// Figures that roll when they change (SPEC-finance-motion): the digits of a PEN amount or of a
// whole percentage. Decorative, like the rest of a row: the row's spoken text names the figure,
// so these live inside `aria-hidden` containers (NumberFlow exposes each digit separately).
import NumberFlow from "@number-flow/react";

const PEN_FORMAT = {
  style: "currency",
  currency: "PEN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

/** "S/ 1,476.50" from cents, rolling. */
export function MoneyFlow({ cents }: { cents: number }) {
  return (
    <NumberFlow value={cents / 100} locales="es-PE" format={PEN_FORMAT} respectMotionPreference />
  );
}

/** "40%" from a whole percentage, rolling; the "< 1%" of 0 stays plain text (it never rolls). */
export function PercentFlow({ percent, fallback }: { percent: number; fallback: string }) {
  if (percent === 0) return <>{fallback}</>;
  return (
    <NumberFlow
      value={percent}
      locales="es-PE"
      suffix="%"
      format={{ maximumFractionDigits: 0 }}
      respectMotionPreference
    />
  );
}
