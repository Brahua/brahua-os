"use client";

// The month by category as a donut (finance-resumen-charts R1): one slice per category (the
// largest 7 and «Otros · N»), the total or the chosen slice in the middle. Each slice is a toggle
// like its row in the list below (the list carries the names and amounts; the donut is the
// shortcut), so a screen reader gets the same name and state. The sweep that draws it on the first
// paint is CSS (nothing hidden until hydration); reduced motion shows it finished.
import { useId, useMemo, useRef, useState } from "react";
import { categoryStyle } from "../category-color";
import { donutGeometry, donutItems, nextSegment } from "../donut-geometry";
import { formatMoney, spokenMoney } from "../money";
import type { MoneyTotal, SummaryGroup } from "../summary";
import { SUMMARY_COPY } from "../summary-copy";
import { useViewportIsPhone } from "./use-viewport";

type CategoryDonutProps = {
  categories: SummaryGroup[];
  total: MoneyTotal;
  /** The month's name for the middle («Octubre 2026»). */
  monthLabel: string;
  /** The categories the list is filtered by (keys, "none" for «Sin categoría»). */
  activeKeys: readonly string[];
  /** A tap: the keys of the slice (several for «Otros») to add or take off the filters. */
  onToggle: (keys: string[]) => void;
};

export function CategoryDonut({
  categories,
  total,
  monthLabel,
  activeKeys,
  onToggle,
}: CategoryDonutProps) {
  const ids = useId();
  const phone = useViewportIsPhone();
  const size = phone ? 208 : 176;
  const thickness = phone ? 28 : 24;
  const items = useMemo(
    () => donutItems(categories, SUMMARY_COPY.uncategorized, SUMMARY_COPY.donutOthers),
    [categories],
  );
  const geometry = useMemo(() => donutGeometry(items, size, thickness), [items, size, thickness]);
  const { segments } = geometry;
  const [hovered, setHovered] = useState(-1);
  const [focused, setFocused] = useState(-1);
  const paths = useRef<(SVGPathElement | null)[]>([]);

  const pressedOf = (keys: readonly string[]) => keys.every((key) => activeKeys.includes(key));
  const filtering = activeKeys.length > 0;
  // What the middle says: the slice under the cursor or with focus, else the chosen one (only when
  // exactly one is), else the month.
  const chosen = segments.findIndex((segment) => pressedOf(segment.keys));
  const picked = focused >= 0 ? focused : hovered >= 0 ? hovered : filtering ? chosen : -1;
  const shown = picked >= 0 ? segments[picked] : null;
  const empty = segments.length === 0;
  const centerAmount = shown
    ? formatMoney(shown.penCents, "PEN")
    : formatMoney(total.penCents, "PEN");

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle(segments[index].keys);
      return;
    }
    const next = nextSegment(index, event.key, segments.length);
    if (next !== index || /^Arrow/.test(event.key)) {
      event.preventDefault();
      paths.current[next]?.focus();
    }
  }

  return (
    <div className="bo-donut" data-category-donut="" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="group"
        aria-label={SUMMARY_COPY.donutLabel}
        className="bo-donut__svg"
      >
        <defs>
          {/* The sweep: a circle stroked over the ring, drawn from the top by a CSS dash. */}
          <mask id={`${ids}-sweep`}>
            <circle
              className="bo-donut__sweep"
              cx={geometry.center}
              cy={geometry.center}
              r={geometry.middle}
              pathLength={1}
              style={{ strokeWidth: thickness + 24 }}
            />
          </mask>
        </defs>
        <circle
          className="bo-donut__track"
          cx={geometry.center}
          cy={geometry.center}
          r={geometry.middle}
          style={{ strokeWidth: thickness }}
        />
        <g mask={`url(#${ids}-sweep)`}>
          {segments.map((segment, index) => {
            const pressed = pressedOf(segment.keys);
            return (
              <path
                key={segment.key}
                ref={(element) => {
                  paths.current[index] = element;
                }}
                d={pressed ? segment.grown : segment.d}
                className="bo-donut__segment"
                style={{
                  ...categoryStyle(segment.colorSlot),
                  opacity: filtering && !pressed ? 0.35 : 1,
                }}
                role="button"
                tabIndex={0}
                aria-pressed={pressed}
                aria-label={SUMMARY_COPY.donutSegment(
                  segment.name,
                  spokenMoney(segment.penCents, "PEN"),
                  segment.percent,
                )}
                data-donut-segment={segment.key}
                onClick={() => onToggle(segment.keys)}
                onKeyDown={(event) => onKeyDown(event, index)}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered((current) => (current === index ? -1 : current))}
                onFocus={(event) => {
                  if (focusVisible(event.currentTarget)) setFocused(index);
                }}
                onBlur={() => setFocused((current) => (current === index ? -1 : current))}
              />
            );
          })}
        </g>
        {focused >= 0 && segments[focused] ? (
          <path className="bo-donut__focus" d={segments[focused].focusRing} />
        ) : null}
      </svg>
      {/* The middle is decorative: each slice already says its name, amount and share. */}
      <div className="bo-donut__center" aria-hidden>
        <span className="bo-donut__label">{shown ? shown.short : SUMMARY_COPY.totalLabel}</span>
        <span className="bo-donut__value bo-amount">
          {empty ? SUMMARY_COPY.donutEmpty : centerAmount}
        </span>
        <span className="bo-donut__sub">
          {shown && shown.percent !== null ? SUMMARY_COPY.donutPercent(shown.percent) : monthLabel}
        </span>
      </div>
    </div>
  );
}

/** Keyboard focus only (not a click's): an engine without `:focus-visible` counts as keyboard. */
function focusVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}
