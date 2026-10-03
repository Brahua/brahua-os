"use client";

import { useRef, useState } from "react";
import { DayCell, type DayState } from "@/design-system";
import { cn } from "@/lib/cn";
import { monthGrid, moveInMonth } from "../calendar";
import { WEEKDAY_FULL, WEEKDAY_LETTERS } from "../history-copy";
import type { DayStatus } from "../streak";

/** One day of the calendar, as its parent computed it. */
export type CalendarDay = {
  status: DayStatus;
  /** A quantity's share of its goal, 0–1 (the partial fill). */
  fill: number;
  /** Its full name and state ("martes 29 de septiembre: 6 de 8 vasos"). */
  label: string;
  /** Whether it can be logged now (today and the 7 days before, from the start, not archived). */
  loggable: boolean;
};

type HabitCalendarProps = {
  /** `YYYY-MM`. */
  month: string;
  /** Lima's today. */
  today: string;
  /** Each day of the month (YYYY-MM-DD) as it shows. */
  dayOf: (day: string) => CalendarDay;
  /** A loggable day was activated (its key is `trigger`: focus goes back there). */
  onOpenDay: (day: string, trigger: HTMLButtonElement) => void;
  /** Ids of the month's title and the help (the grid's name and description). */
  labelledBy: string;
  describedBy: string;
};

/** A day's DayCell state: done, rest (paused), still to come, today pending, not met, partial… */
function cellState(status: DayStatus, isToday: boolean): DayState {
  switch (status) {
    case "done":
      return "done";
    case "paused":
      return "rest";
    case "future":
      return "upcoming";
    case "partial":
      return "partial";
    case "notScheduled":
    case "beforeStart":
      return "off";
    case "empty":
      return isToday ? "today" : "empty";
  }
}

/**
 * H5: a habit's month (SPEC-habits "Detalle"), Monday first, as a grid (`role="grid"`): each day
 * is a key named with its full day and state ("martes 29 de septiembre: 6 de 8 vasos"), with its
 * `DayCell` (done; partial with an intensity; rest when paused; empty, never red; still to come).
 * One tab stop (roving tabindex): ← → a day, ↑ ↓ a week, Home/End its week's ends, Ctrl/⌘ +
 * Home/End the month's. The days that can be logged open the adjust sheet; the others are
 * `aria-disabled` (still focusable, so they can be read).
 */
export function HabitCalendar({
  month,
  today,
  dayOf,
  onOpenDay,
  labelledBy,
  describedBy,
}: HabitCalendarProps) {
  const weeks = monthGrid(month);
  const inMonth = today.startsWith(month);
  const [focused, setFocused] = useState(inMonth ? today : `${month}-01`);
  const keys = useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, day: string) {
    if (event.altKey || event.shiftKey) return;
    const target = moveInMonth(day, month, event);
    if (target === null) return;
    event.preventDefault();
    setFocused(target);
    keys.current.get(target)?.focus();
  }

  return (
    <div
      role="grid"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      data-habit-calendar={month}
    >
      <div role="row" className="bo-habit-calendar">
        {WEEKDAY_LETTERS.map((letter, index) => (
          <div key={WEEKDAY_FULL[index]} role="columnheader" className="bo-habit-calendar__head">
            <span aria-hidden>{letter}</span>
            <span className="sr-only">{WEEKDAY_FULL[index]}</span>
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week.find(Boolean)} role="row" className="bo-habit-calendar mt-1">
          {week.map((day, index) => {
            if (day === null) return <div key={`blank-${index}`} role="gridcell" />;
            const cell = dayOf(day);
            const isToday = day === today;
            return (
              <div key={day} role="gridcell">
                <button
                  ref={(element) => {
                    if (element) keys.current.set(day, element);
                    else keys.current.delete(day);
                  }}
                  type="button"
                  tabIndex={day === focused ? 0 : -1}
                  aria-label={cell.label}
                  aria-disabled={cell.loggable ? undefined : true}
                  aria-current={isToday ? "date" : undefined}
                  aria-haspopup={cell.loggable ? "dialog" : undefined}
                  data-day={day}
                  data-status={cell.status}
                  className={cn("bo-habit-calendar__day", isToday && "is-today")}
                  onFocus={() => setFocused(day)}
                  onKeyDown={(event) => onKeyDown(event, day)}
                  onClick={(event) => {
                    if (cell.loggable) onOpenDay(day, event.currentTarget);
                  }}
                >
                  <span aria-hidden>{Number(day.slice(8))}</span>
                  <DayCell
                    aria-hidden
                    size="lg"
                    state={cellState(cell.status, isToday)}
                    today={isToday}
                    fill={cell.fill}
                  />
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
