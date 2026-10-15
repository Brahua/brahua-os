"use client";

// The month's pace (finance-motion M4): the running total per day as a line over a soft area,
// the previous month dotted, today marked in `signal`. SVG for the strokes (they stretch; their
// width does not), HTML for the dot and the tooltip (they must not stretch). It draws no money
// of its own: it takes the series the page already computed. Cursor, touch and ← → show a day.
import { useId, useRef, useState } from "react";
import {
  areaPath,
  chartMax,
  indexAt,
  linePath,
  pointOf,
  pointsOf,
  stepIndex,
} from "../chart-geometry";
import { formatMoney, spokenMoney } from "../money";
import { SUMMARY_COPY } from "../summary-copy";

type AreaChartProps = {
  /** The month's running total per day, for the days that count (up to today in the current month). */
  current: readonly number[];
  /** The previous month's running total per day over the same days; null: no dotted line. */
  previous: readonly number[] | null;
  /** The days of the month: the plot's width. */
  days: number;
  /** Today's day number while the month is current (marked), else null. */
  today: number | null;
};

const percent = (value: number) => `${value.toFixed(2)}%`;

export function AreaChart({ current, previous, days, today }: AreaChartProps) {
  const ids = useId();
  const plot = useRef<HTMLDivElement>(null);
  const last = Math.max(0, current.length - 1);
  // Null: nothing selected (the cursor rests on today / the last day while untouched).
  const [picked, setPicked] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const hasPrevious = previous !== null && previous.some((value) => value > 0);
  const dotted = hasPrevious ? previous : null;
  const max = chartMax(current, dotted);

  const rest = today !== null ? Math.min(today - 1, last) : last;
  const index = picked ?? rest;
  const total = current[index] ?? 0;
  const before = dotted ? (dotted[Math.min(index, dotted.length - 1)] ?? 0) : null;

  const points = pointsOf(current, days, max);
  const previousPoints = dotted ? pointsOf(dotted, days, max) : [];
  const cursor = pointOf(index, total, days, max);
  const spokenAt = (at: number) =>
    SUMMARY_COPY.chartTooltipSpoken(
      at + 1,
      spokenMoney(current[at] ?? 0, "PEN"),
      dotted ? spokenMoney(dotted[Math.min(at, dotted.length - 1)] ?? 0, "PEN") : null,
    );

  function fromPointer(event: React.PointerEvent) {
    const box = plot.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setPicked(
      indexAt((event.clientX - box.left) / box.width, days) > last
        ? last
        : indexAt((event.clientX - box.left) / box.width, days),
    );
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const next = stepIndex(index, event.key, last);
    if (next === index && !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setPicked(next);
    setSaid(spokenAt(next));
  }

  const description = SUMMARY_COPY.chartSpoken(
    rest + 1,
    spokenMoney(current[rest] ?? 0, "PEN"),
    dotted ? spokenMoney(dotted[Math.min(rest, dotted.length - 1)] ?? 0, "PEN") : null,
  );

  return (
    <div className="bo-chart" data-area-chart="">
      <div
        ref={plot}
        className="bo-chart__plot"
        role="img"
        aria-label={description}
        aria-describedby={`${ids}-hint`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setPicked(null)}
        onPointerMove={fromPointer}
        onPointerDown={fromPointer}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setPicked(null);
        }}
      >
        <svg
          className="bo-chart__svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
          focusable="false"
        >
          <path className="bo-chart__area" d={areaPath(points)} />
          {dotted ? <path className="bo-chart__previous" d={linePath(previousPoints)} /> : null}
          {/* `pathLength="1"` lets CSS draw it with a dash: plays on first paint, no JS. */}
          <path className="bo-chart__line" d={linePath(points)} pathLength={1} />
        </svg>
        {today !== null ? (
          <span
            className="bo-chart__today"
            style={{ left: percent(pointOf(Math.min(today - 1, days - 1), 0, days, max).x) }}
            aria-hidden
          />
        ) : null}
        <span
          className="bo-chart__dot"
          style={{ left: percent(cursor.x), top: percent(cursor.y) }}
          aria-hidden
        />
        {picked !== null ? (
          <span
            className="bo-chart__tooltip bo-amount"
            style={{ left: percent(Math.min(88, Math.max(12, cursor.x))) }}
            data-chart-tooltip=""
            aria-hidden
          >
            <span>{`${SUMMARY_COPY.chartDay(index + 1)}: ${formatMoney(total, "PEN")}`}</span>
            {before !== null ? (
              <span className="text-text-secondary">
                {`${SUMMARY_COPY.chartPrevious} ${formatMoney(before, "PEN")}`}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <p id={`${ids}-hint`} className="bo-text-body-sm text-text-secondary">
        {SUMMARY_COPY.chartHint}
      </p>
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
      {dotted ? (
        <p className="bo-chart__legend bo-text-body-sm text-text-secondary" aria-hidden>
          <span className="bo-chart__key bo-chart__key--line" />
          {SUMMARY_COPY.chartThisMonth}
          <span className="bo-chart__key bo-chart__key--dotted" />
          {SUMMARY_COPY.chartPrevious}
        </p>
      ) : null}
    </div>
  );
}
