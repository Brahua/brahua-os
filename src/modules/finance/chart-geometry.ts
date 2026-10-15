// The pace chart's geometry (finance-motion M4): pure, in percentages of the plot so the SVG can
// stretch (`preserveAspectRatio="none"`, non-scaling strokes) while dots and tooltips are HTML.
// A series is a running total per day (index 0 is day 1).

export type Point = { x: number; y: number };

/** The tallest value the plot must hold: never 0 (an empty axis would divide by zero). */
export function chartMax(...series: readonly (readonly number[] | null)[]): number {
  let max = 0;
  for (const values of series) for (const value of values ?? []) max = Math.max(max, value);
  return max;
}

/** The point of day `index + 1` in a plot of `days` days: x and y in 0…100 (y grows downwards). */
export function pointOf(index: number, value: number, days: number, max: number): Point {
  return {
    x: days <= 1 ? 0 : (index / (days - 1)) * 100,
    y: max <= 0 ? 100 : 100 - (value / max) * 100,
  };
}

export const pointsOf = (series: readonly number[], days: number, max: number): Point[] =>
  series.map((value, index) => pointOf(index, value, days, max));

const fix = (value: number) => Number(value.toFixed(2));

/** An SVG path through the points (`M … L …`). */
export function linePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${fix(p.x)} ${fix(p.y)}`).join(" ");
}

/** The same line closed down to the baseline: the soft area under the month's line. */
export function areaPath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const last = points[points.length - 1];
  return `${linePath(points)} L${fix(last.x)} 100 L${fix(points[0].x)} 100 Z`;
}

/** The day index (0-based) under a pointer at `fraction` (0…1) of the plot's width. */
export function indexAt(fraction: number, days: number): number {
  if (days <= 1) return 0;
  return Math.min(days - 1, Math.max(0, Math.round(fraction * (days - 1))));
}

/** ← and → move the cursor one day, Home/End to the ends; always within the days shown. */
export function stepIndex(index: number, key: string, last: number): number {
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "ArrowRight":
      return Math.min(last, index + 1);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return index;
  }
}
