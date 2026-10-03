import { cn } from "@/lib/cn";

/**
 * A calendar day's cell state: the design system's `DayCell` states (done, rest, today, upcoming)
 * plus the three H5 needs that `DayCell` doesn't have yet (PENDING UPSTREAM, styles in
 * overrides.css): `empty` (a past day not met: an empty outlined cell, never red), `partial` (a
 * quantity under its goal, filled up to `fill`) and `off` (a day that doesn't count).
 */
export type CalendarCellState =
  "done" | "rest" | "today" | "upcoming" | "empty" | "partial" | "off";

/**
 * The `DayCell` look (its `bo-daycell` classes, large size) for the habit calendar, decorative
 * (`aria-hidden`: the day's key says its state in words). Kept in `habits` until Claude Design adds
 * the states, so a design sync never overwrites it; then it becomes `<DayCell>` again.
 */
export function CalendarDayCell({
  state,
  today,
  fill = 0,
}: {
  state: CalendarCellState;
  today: boolean;
  /** `partial`: how much of the goal is done, 0–1. */
  fill?: number;
}) {
  return (
    <span
      aria-hidden
      className={cn("bo-daycell bo-daycell--lg", `is-${state}`, today && "is-today")}
      style={
        state === "partial"
          ? ({ "--fill": Math.max(0, Math.min(1, fill)) } as React.CSSProperties)
          : undefined
      }
    />
  );
}
