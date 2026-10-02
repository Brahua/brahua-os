"use client";

import { useId } from "react";
import { AREA_ICONS, Icon, Key, Led, SegmentBar } from "@/design-system";
import { cn } from "@/lib/cn";
import type { HabitItem } from "../habit-input";
import { hasRelapse, isDayDone } from "../habit-status";
import { HABITS_COPY } from "../habits-copy";
import { FREQUENCY_COPY } from "../frequency-copy";
import { MEASURE_COPY } from "../measure-copy";
import { weekProgress } from "../week-progress";

/** The selector of a habit's pad (focus after create, delete and undo). */
export const habitPadSelector = (id: string) => `[data-habit-pad="${CSS.escape(id)}"]`;

/** A quantity pad's bar is short: one segment per unit up to this many, then proportional. */
export const PAD_SEGMENTS_MAX = 10;

/**
 * The quantity pad's `SegmentBar`: one segment per unit for a goal up to 10 ("3/8 vasos" is 3 of
 * 8), else 10 segments filled in proportion (rounded down, so it is full only at the goal).
 */
export function padSegments(quantity: number, target: number): { total: number; filled: number } {
  const reached = Math.min(Math.max(quantity, 0), target);
  if (target <= PAD_SEGMENTS_MAX) return { total: target, filled: reached };
  return {
    total: PAD_SEGMENTS_MAX,
    filled: Math.floor((reached * PAD_SEGMENTS_MAX) / target),
  };
}

/**
 * The pad's small status line (mono, uppercase). A yes/no: "HECHO" once the day is done. A
 * quantity: "3/8 VASOS". A habit to avoid: "SIN RECAÍDAS HOY" / "RECAÍDA REGISTRADA HOY" (never
 * red; H4 adds the clean days, "12 DÍAS LIMPIO"). H4 slot (Rachas): "RACHA 8" while not done.
 * Decorative (`aria-hidden`): the pressed state, the name and the description already say it.
 */
export function padStatus(habit: HabitItem): string {
  if (habit.kind === "avoid") {
    return hasRelapse(habit) ? MEASURE_COPY.padSlipped : MEASURE_COPY.padClean;
  }
  if (habit.measure === "quantity") {
    return MEASURE_COPY.padQuantity(habit.quantity, habit.target, habit.unit ?? "");
  }
  if (isDayDone(habit)) return HABITS_COPY.padDone;
  return "";
}

type HabitPadProps = {
  habit: HabitItem;
  /**
   * One tap of a yes/no habit: the day as wanted (`done`), not a toggle on the server. For a
   * habit to avoid, `done` is "a relapse is logged today".
   */
  onToggle: (habit: HabitItem, done: boolean) => void;
  /** One tap of a quantity habit: add its step (required: a quantity pad without it is dead). */
  onAdd: (habit: HabitItem) => void;
  /** Room on the top right for a control drawn over the pad (the options key). */
  reserveCorner?: boolean;
  className?: string;
};

/**
 * A habit's pad (the design system's `HabitPad` pattern: a `Key` + `Led` + a status line). A
 * yes/no is a toggle (`aria-pressed`): one tap marks today, another unmarks it. A habit to avoid
 * is a toggle named "Registrar recaída: X", pressed while today has a relapse. A quantity is a
 * plain key: each tap adds its step ("3/8 vasos" and a short `SegmentBar`), and it looks "on"
 * once the goal is reached. Its name is the habit's name (a habit to avoid's says what a tap
 * does, with the name in it). `today` (H6) can render it too, inside
 * `HabitsScreenWithin`.
 */
export function HabitPad({
  habit,
  onToggle,
  onAdd,
  reserveCorner = false,
  className,
}: HabitPadProps) {
  const done = isDayDone(habit);
  const status = padStatus(habit);
  const ids = useId();
  const areaId = `${ids}-area`;
  const helpId = `${ids}-help`;
  const weekId = `${ids}-week`;
  const { area } = habit;
  // H2: "2 de 3 esta semana" for "X veces por semana" (decorative here; the description says it).
  const week = weekProgress(habit, done);
  const weekText = week ? FREQUENCY_COPY.weekProgress(week.done, week.quota) : null;
  const avoid = habit.kind === "avoid";
  const quantity = !avoid && habit.measure === "quantity";
  const slipped = hasRelapse(habit);
  const unit = habit.unit ?? "";
  const segments = quantity ? padSegments(habit.quantity, habit.target) : null;
  // A yes/no's status ("HECHO", H4's "RACHA 8") is short: it fits the top row.
  const ownLine = quantity || avoid;
  // What a screen reader hears after the name: what is logged (quantity, avoid) and the area.
  const help = quantity
    ? MEASURE_COPY.padQuantityHelp(habit.quantity, habit.target, unit, habit.step)
    : avoid
      ? MEASURE_COPY.padAvoidHelp(slipped)
      : null;
  const describedBy = [help ? helpId : null, area ? areaId : null, weekText ? weekId : null]
    .filter(Boolean)
    .join(" ");

  const toggleProps = quantity
    ? { onClick: () => onAdd(habit) }
    : {
        toggle: true,
        // A habit to avoid: pressed = today's relapse is logged (its LED stays on while clean).
        pressed: avoid ? slipped : done,
        onPressedChange: (next: boolean) => onToggle(habit, next),
      };

  return (
    <>
      <Key
        {...toggleProps}
        className={cn("bo-key--pad w-full", quantity && done && "is-on", className)}
        // The visible name is part of it (WCAG 2.5.3): "Registrar recaída: No fumar".
        aria-label={avoid ? MEASURE_COPY.padAvoidName(habit.name) : undefined}
        // What is logged, the area (its color and icon are decorative) and the week, described.
        aria-describedby={describedBy || undefined}
        data-habit-pad={habit.id}
        data-habit-kind={habit.kind}
        data-habit-measure={habit.measure}
      >
        {/* With a control over the corner, the row is as tall as it, so the name starts below. */}
        <span
          className={cn("flex items-center gap-2", reserveCorner ? "min-h-10 pr-12" : "min-h-6")}
        >
          <Led area={area?.color} on={done} />
          {/* Not only color (WCAG 1.4.1): the area's icon too. */}
          {area ? <Icon icon={AREA_ICONS[area.icon]} size="sm" aria-hidden /> : null}
          {ownLine ? null : (
            <span className="bo-key__sub truncate" aria-hidden>
              {status}
            </span>
          )}
        </span>

        {/* H3: a quantity's "3/8 VASOS" over a short bar, or a habit to avoid's state, on a line
            of their own (next to the options key they were cut short on the phone). */}
        {ownLine ? (
          <span className="flex flex-col gap-1.5" aria-hidden>
            <span className="bo-key__sub break-words">{status}</span>
            {segments ? (
              <SegmentBar
                total={segments.total}
                filled={segments.filled}
                aria-hidden
                className="bo-pad-segbar"
              />
            ) : null}
          </span>
        ) : null}

        <span className="line-clamp-3 break-words">{habit.name}</span>
        {weekText ? (
          <span className="bo-key__sub" aria-hidden data-habit-week="">
            {weekText}
          </span>
        ) : null}
      </Key>
      {help ? (
        <span id={helpId} hidden>
          {help}
        </span>
      ) : null}
      {area ? (
        <span id={areaId} hidden>
          {HABITS_COPY.padArea(area.name)}
        </span>
      ) : null}
      {weekText ? (
        <span id={weekId} hidden>
          {weekText}
        </span>
      ) : null}
    </>
  );
}
