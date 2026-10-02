"use client";

import { useId } from "react";
import { AREA_ICONS, Icon, Key, Led } from "@/design-system";
import { cn } from "@/lib/cn";
import type { HabitItem } from "../habit-input";
import { isDayDone } from "../habit-status";
import { HABITS_COPY } from "../habits-copy";
import { FREQUENCY_COPY } from "../frequency-copy";
import { weekProgress } from "../week-progress";

/** The selector of a habit's pad (focus after create, delete and undo). */
export const habitPadSelector = (id: string) => `[data-habit-pad="${CSS.escape(id)}"]`;

/**
 * The pad's small status line (mono, uppercase). H1: "HECHO" once the day is done. H3 slot
 * (Cantidad / A evitar): "3/8 VASOS", "12 DÍAS LIMPIO". H4 slot (Rachas): "RACHA 8" while not
 * done. Decorative (`aria-hidden`): the pressed state and the name already say it.
 */
export function padStatus(habit: HabitItem): string {
  if (isDayDone(habit)) return HABITS_COPY.padDone;
  return "";
}

type HabitPadProps = {
  habit: HabitItem;
  /** One tap: the day as wanted (`done`), not a toggle on the server. */
  onToggle: (habit: HabitItem, done: boolean) => void;
  /** Room on the top right for a control drawn over the pad (the options key). */
  reserveCorner?: boolean;
  className?: string;
};

/**
 * A habit's pad (the design system's `HabitPad` pattern: a toggle `Key` + `Led` + a status
 * line): one tap marks today, another unmarks it (`aria-pressed`). Its name is the habit's name.
 * `today` (H6) can render it too, inside `HabitsScreenWithin`.
 */
export function HabitPad({ habit, onToggle, reserveCorner = false, className }: HabitPadProps) {
  const done = isDayDone(habit);
  const status = padStatus(habit);
  const areaId = useId();
  const weekId = useId();
  const { area } = habit;
  // H2: "2 de 3 esta semana" for "X veces por semana" (decorative here; the description says it).
  const week = weekProgress(habit, done);
  const weekText = week ? FREQUENCY_COPY.weekProgress(week.done, week.quota) : null;
  const describedBy = [area ? areaId : null, weekText ? weekId : null].filter(Boolean).join(" ");
  return (
    <>
      <Key
        toggle
        pressed={done}
        onPressedChange={(next) => onToggle(habit, next)}
        className={cn("bo-key--pad w-full", className)}
        // The area (its color and icon are decorative on the pad) and the week as a description.
        aria-describedby={describedBy || undefined}
        data-habit-pad={habit.id}
      >
        {/* With a control over the corner, the row is as tall as it, so the name starts below. */}
        <span
          className={cn("flex items-center gap-2", reserveCorner ? "min-h-10 pr-12" : "min-h-6")}
        >
          <Led area={area?.color} on={done} />
          {/* Not only color (WCAG 1.4.1): the area's icon too. */}
          {area ? <Icon icon={AREA_ICONS[area.icon]} size="sm" aria-hidden /> : null}
          <span className="bo-key__sub truncate" aria-hidden>
            {status}
          </span>
        </span>

        {/* H3 slot (Cantidad): "3/8 vasos" and a short SegmentBar. */}

        <span className="line-clamp-3 break-words">{habit.name}</span>
        {weekText ? (
          <span className="bo-key__sub" aria-hidden data-habit-week="">
            {weekText}
          </span>
        ) : null}
      </Key>
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
