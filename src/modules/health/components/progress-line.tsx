// A small line of one value per session (SPEC-health "Detalle del ejercicio"): our own SVG, no
// dependency and nothing shared with finance's chart. The drawing is decoration (aria-hidden);
// the same points are a visually hidden table, the accessible equivalent. A Server Component.
import { RECORDS_COPY as COPY } from "../records-copy";

/** The drawing's box (SVG units); it scales with the width and keeps its aspect. */
export const LINE_WIDTH = 320;
export const LINE_HEIGHT = 120;
/** Fewer points than this are not drawn (E5): the page says when the line shows up instead. */
export const LINE_MIN_POINTS = 2;
const PADDING = 8;

export type LineCoordinate = { x: number; y: number };

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Where each value goes in a `width` × `height` box with `padding` on every side: evenly spaced
 * from left to right (one value: in the middle), the highest on top, the lowest at the bottom (all
 * equal: in the middle). Returns the points and the path through them.
 */
export function lineGeometry(
  values: readonly number[],
  width = LINE_WIDTH,
  height = LINE_HEIGHT,
  padding = PADDING,
): { points: LineCoordinate[]; path: string } {
  if (values.length === 0) return { points: [], path: "" };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const innerWidth = width - 2 * padding;
  const innerHeight = height - 2 * padding;
  const points = values.map((value, index) => ({
    x: round(
      values.length === 1 ? width / 2 : padding + (index * innerWidth) / (values.length - 1),
    ),
    y: round(high === low ? height / 2 : padding + ((high - value) / (high - low)) * innerHeight),
  }));
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
  return { points, path };
}

export type ProgressPoint = {
  key: string;
  /** The session's day as the table says it. */
  day: string;
  value: number;
  /** The value as written: «82,5 kg». */
  valueText: string;
};

type ProgressLineProps = {
  title: string;
  points: readonly ProgressPoint[];
};

export function ProgressLine({ title, points }: ProgressLineProps) {
  const { points: coordinates, path } = lineGeometry(points.map((point) => point.value));
  const lowest = points.reduce(
    (best, point) => (point.value < best.value ? point : best),
    points[0],
  );
  const highest = points.reduce(
    (best, point) => (point.value > best.value ? point : best),
    points[0],
  );
  return (
    <figure className="flex flex-col gap-2" data-progress-line="">
      <svg
        viewBox={`0 0 ${LINE_WIDTH} ${LINE_HEIGHT}`}
        className="h-auto w-full max-w-160 text-text"
        aria-hidden
        focusable="false"
      >
        <line
          x1={PADDING}
          x2={LINE_WIDTH - PADDING}
          y1={LINE_HEIGHT - PADDING}
          y2={LINE_HEIGHT - PADDING}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {coordinates.length > 1 ? (
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {coordinates.map((point, index) => (
          <circle key={points[index].key} cx={point.x} cy={point.y} r={2.5} fill="currentColor" />
        ))}
      </svg>
      {points.length > 0 ? (
        <figcaption
          className="bo-text-body-sm flex max-w-160 flex-col gap-1 text-text-secondary"
          aria-hidden
        >
          <span className="flex justify-between gap-3" data-progress-days="">
            <span>{points[0].day}</span>
            {points.length > 1 ? <span>{points.at(-1)!.day}</span> : null}
          </span>
          <span>{COPY.lineRange(lowest.valueText, highest.valueText)}</span>
        </figcaption>
      ) : null}
      <table className="sr-only" data-progress-table="">
        <caption>{COPY.lineTable(title)}</caption>
        <thead>
          <tr>
            <th scope="col">{COPY.columnDay}</th>
            <th scope="col">{COPY.columnBest}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <td>{point.day}</td>
              <td>{point.valueText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
