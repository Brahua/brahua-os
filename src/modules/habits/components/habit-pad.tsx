"use client";

import { useId } from "react";
import { AREA_ICONS, Icon, Key, Led, SegmentBar } from "@/design-system";
import { cn } from "@/lib/cn";
import type { HabitItem } from "../habit-input";
import { hasRelapse, isDayDone } from "../habit-status";
import { HABITS_COPY } from "../habits-copy";
import { FREQUENCY_COPY } from "../frequency-copy";
import { MEASURE_COPY } from "../measure-copy";
import { STREAK_COPY } from "../pause-copy";
import { shownStreak, type Streak } from "../streak";
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

/** H4: the streak the pad shows, for today's state (it moves at once after a tap). */
export function padStreak(habit: HabitItem): Streak {
  return shownStreak(habit.streak, isDayDone(habit));
}

/**
 * The pad's small status line (mono, uppercase). A yes/no: "HECHO" once the day is done. A
 * quantity: "3/8 VASOS". A habit to avoid (H4): its clean days, today included, "12 DÍAS
 * LIMPIO", or "EMPIEZAS DE NUEVO HOY" after a relapse today (never red, never "lost").
 * Decorative (`aria-hidden`): the pressed state, the name and the description already say it.
 */
export function padStatus(habit: HabitItem): string {
  if (habit.kind === "avoid") {
    return hasRelapse(habit)
      ? STREAK_COPY.padStartAgain
      : STREAK_COPY.padClean(padStreak(habit).count);
  }
  if (habit.measure === "quantity") {
    return MEASURE_COPY.padQuantity(habit.quantity, habit.target, habit.unit ?? "");
  }
  if (isDayDone(habit)) return HABITS_COPY.padDone;
  return "";
}

/**
 * H4: the streak line of a habit to keep, "RACHA 8" (days) or "RACHA 3 SEM" (weeks); none at 0
 * (an empty line, never "RACHA 0"). The best streak is the habit page's (H5), not the pad's.
 */
export function padStreakLine(habit: HabitItem): string | null {
  if (habit.kind === "avoid") return null;
  const streak = padStreak(habit);
  return streak.count > 0 ? STREAK_COPY.pad(streak.count, streak.unit) : null;
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
  /**
   * Room on the top right for the control(s) drawn over the pad: the options key (`true`), or two
   * keys side by side (`"wide"`, a quantity pad on the board: "Ajustar" and the options).
   */
  reserveCorner?: boolean | "wide";
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
  const streakId = `${ids}-streak`;
  const { area } = habit;
  // H2: "2 de 3 esta semana" for "X veces por semana" (decorative here; the description says it).
  const week = weekProgress(habit, done);
  const weekText = week ? FREQUENCY_COPY.weekProgress(week.done, week.quota) : null;
  const avoid = habit.kind === "avoid";
  const quantity = !avoid && habit.measure === "quantity";
  const slipped = hasRelapse(habit);
  const unit = habit.unit ?? "";
  const segments = quantity ? padSegments(habit.quantity, habit.target) : null;
  // H4: "RACHA 8" under the name (a habit to avoid says its clean days in its status line).
  const streakLine = padStreakLine(habit);
  const streak = padStreak(habit);
  // A yes/no's status ("HECHO", H4's "RACHA 8") is short: it fits the top row.
  const ownLine = quantity || avoid;
  // What a screen reader hears after the name: what is logged (quantity, avoid) and the area.
  const help = quantity
    ? MEASURE_COPY.padQuantityHelp(habit.quantity, habit.target, unit, habit.step)
    : avoid
      ? `${slipped ? STREAK_COPY.startAgainHelp : STREAK_COPY.cleanHelp(streak.count)} ${MEASURE_COPY.padAvoidHelp(slipped)}`
      : null;
  const describedBy = [
    help ? helpId : null,
    area ? areaId : null,
    weekText ? weekId : null,
    streakLine ? streakId : null,
  ]
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
          className={cn(
            "flex items-center gap-2",
            reserveCorner === "wide"
              ? "min-h-10 pr-24"
              : reserveCorner
                ? "min-h-10 pr-12"
                : "min-h-6",
          )}
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
        {streakLine ? (
          <span className="bo-key__sub" aria-hidden data-habit-streak="">
            {streakLine}
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
      {streakLine ? (
        <span id={streakId} hidden>
          {STREAK_COPY.padHelp(streak.count, streak.unit)}
        </span>
      ) : null}
    </>
  );
}
