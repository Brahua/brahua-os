// The category donut's geometry (finance-resumen-charts R1): pure, in SVG user units. It only draws
// what `summary.ts` already computed (shares and whole percentages): it never recalculates money.
import { OTHER_SLOT } from "./category-color";
import type { SummaryGroup } from "./summary";
import { groupKey } from "./summary";

const TAU = Math.PI * 2;

/** One slice of the donut: a category, or «Otros · N» standing for several. */
export type DonutItem = {
  key: string;
  name: string;
  /** Short name for the center («Otros · 3»). */
  short: string;
  penCents: number;
  /** The whole percentage `summary.ts` gave it (sum of the grouped ones for «Otros»). */
  percent: number | null;
  colorSlot: number | null;
  /** The category keys a tap on it filters by (all of them for «Otros»). */
  keys: string[];
};

/** The most slices a donut shows: the largest 7 and «Otros». */
export const MAX_SLICES = 8;

/**
 * The slices of a donut from the summary's categories: only those with PEN, biggest first (the
 * summary's order); with more than `max` the smallest go into one «Otros · N categorías».
 */
export function donutItems(
  categories: readonly SummaryGroup[],
  noCategory: string,
  others: (count: number) => { name: string; short: string },
  max = MAX_SLICES,
): DonutItem[] {
  const items = categories
    .filter((group) => group.penCents > 0)
    .map<DonutItem>((group) => ({
      key: groupKey(group),
      name: group.name ?? noCategory,
      short: group.name ?? noCategory,
      penCents: group.penCents,
      percent: group.percent,
      colorSlot: group.colorSlot,
      keys: [groupKey(group)],
    }));
  if (items.length <= max) return items;
  const rest = items.slice(max - 1);
  const labels = others(rest.length);
  return [
    ...items.slice(0, max - 1),
    {
      key: "others",
      name: labels.name,
      short: labels.short,
      penCents: rest.reduce((sum, item) => sum + item.penCents, 0),
      percent: rest.reduce((sum, item) => sum + (item.percent ?? 0), 0),
      colorSlot: OTHER_SLOT,
      keys: rest.flatMap((item) => item.keys),
    },
  ];
}

const point = (cx: number, radius: number, angle: number): [string, string] => [
  (cx + radius * Math.sin(angle)).toFixed(2),
  (cx - radius * Math.cos(angle)).toFixed(2),
];

/** The path of a ring sector between two radii and two angles (0 is the top, clockwise). */
export function sectorPath(cx: number, inner: number, outer: number, a0: number, a1: number) {
  if (a1 - a0 >= TAU - 1e-4) {
    // A whole ring: two arcs per edge (one arc cannot close a circle), the inner one reversed.
    const [o1, o2] = [point(cx, outer, 0), point(cx, outer, Math.PI)];
    const [i1, i2] = [point(cx, inner, 0), point(cx, inner, Math.PI)];
    return `M${o1} A${outer} ${outer} 0 1 1 ${o2} A${outer} ${outer} 0 1 1 ${o1} Z M${i1} A${inner} ${inner} 0 1 0 ${i2} A${inner} ${inner} 0 1 0 ${i1} Z`;
  }
  const big = a1 - a0 > Math.PI ? 1 : 0;
  return `M${point(cx, outer, a0)} A${outer} ${outer} 0 ${big} 1 ${point(cx, outer, a1)} L${point(cx, inner, a1)} A${inner} ${inner} 0 ${big} 0 ${point(cx, inner, a0)} Z`;
}

export type DonutSegment = DonutItem & {
  start: number;
  end: number;
  /** The slice's path, the same grown outwards (selected), and the ring drawn around it (focus). */
  d: string;
  grown: string;
  focusRing: string;
};

export type DonutGeometry = {
  size: number;
  center: number;
  /** Radius of the middle of the ring: the background circle is stroked at it. */
  middle: number;
  thickness: number;
  segments: DonutSegment[];
};

/**
 * The donut for `size` px and a ring `thickness`: each slice gets the angle of its share of the
 * PEN total, with a gap between neighbours (never with a single slice: it is a whole ring).
 */
export function donutGeometry(
  items: readonly DonutItem[],
  size: number,
  thickness: number,
): DonutGeometry {
  const center = size / 2;
  const outer = center - 8;
  const inner = outer - thickness;
  const middle = (outer + inner) / 2;
  const total = items.reduce((sum, item) => sum + item.penCents, 0);
  const many = items.length > 1;
  const segments: DonutSegment[] = [];
  let accumulated = 0;
  if (total > 0) {
    for (const item of items) {
      const start = (accumulated / total) * TAU;
      const end = ((accumulated + item.penCents) / total) * TAU;
      accumulated += item.penCents;
      const gap = many ? Math.min(1 / middle, (end - start) / 4) : 0;
      const a0 = start + gap;
      const a1 = end - gap;
      const extra = many ? 3 / middle : 0;
      segments.push({
        ...item,
        start,
        end,
        d: sectorPath(center, inner, outer, a0, a1),
        grown: sectorPath(center, inner, outer + 4, a0, a1),
        focusRing: sectorPath(center, inner - 3, outer + 7, a0 - extra, a1 + extra),
      });
    }
  }
  return { size, center, middle, thickness, segments };
}

/** The next slice's index in a circle: arrows go on, wrapping around the ends. */
export function nextSegment(index: number, key: string, count: number): number {
  if (count === 0) return 0;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index + count - 1) % count;
  return index;
}
