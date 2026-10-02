"use client";

// H4's section of "Hoy": the folded "En pausa (N)", with "Reanudar" and the options of each
// habit paused today. Same disclosure pattern as H2's sections (`FoldedSection`).
import { Ellipsis, Play } from "lucide-react";
import { AREA_ICONS, Icon, IconKey, Key, Led } from "@/design-system";
import type { HabitItem } from "../habit-input";
import { HABITS_COPY } from "../habits-copy";
import { PAUSE_COPY } from "../pause-copy";
import { FoldedSection } from "./habit-sections";

/** The selector of a paused habit's "Reanudar" key (focus after pausing). */
export const resumeSelector = (id: string) => `[data-habit-resume="${CSS.escape(id)}"]`;

type PausedHabitsProps = {
  habits: HabitItem[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onResume: (habit: HabitItem) => void;
  /** Opens the habit's options (edit, archive, delete…); `trigger` gets focus back. */
  onOptions: (habit: HabitItem, trigger: HTMLElement) => void;
  onOptionsHover?: () => void;
};

/**
 * "En pausa (N)" below the grids of "Hoy" (SPEC-habits "Pantallas"): the habits a pause covers
 * today, out of the grids and the count, with until when and why, "Reanudar" and their options.
 * Hidden when there are none.
 */
export function PausedHabits({
  habits,
  expanded,
  onExpandedChange,
  onResume,
  onOptions,
  onOptionsHover,
}: PausedHabitsProps) {
  if (habits.length === 0) return null;
  return (
    <FoldedSection
      title={PAUSE_COPY.pausedSection}
      count={habits.length}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      name="paused"
    >
      <p className="bo-text-body-sm max-w-160 text-text-secondary">{PAUSE_COPY.pausedHelp}</p>
      <ul aria-label={PAUSE_COPY.pausedList} className="bo-list max-w-160">
        {habits.map((habit) => (
          <li
            key={habit.id}
            data-paused-habit={habit.id}
            className="flex min-h-14 items-center gap-2 bg-surface py-1 pr-2 pl-4"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
              <span className="bo-text-body flex min-w-0 items-center gap-2">
                {/* Off: resting, never red. */}
                <Led area={habit.area?.color} />
                {habit.area ? (
                  <Icon icon={AREA_ICONS[habit.area.icon]} size="sm" aria-hidden />
                ) : null}
                <span className="line-clamp-2 break-words">{habit.name}</span>
                {habit.area ? (
                  <span className="sr-only">{HABITS_COPY.padArea(habit.area.name)}</span>
                ) : null}
              </span>
              {habit.pause ? (
                <span className="bo-text-body-sm text-text-secondary">
                  {PAUSE_COPY.pausedUntil(habit.pause.endDate, habit.pause.reason)}
                </span>
              ) : null}
            </span>
            <Key
              variant="ghost"
              icon={Play}
              aria-label={PAUSE_COPY.resumeRow(habit.name)}
              data-habit-resume={habit.id}
              onClick={() => onResume(habit)}
            >
              <span className="max-sm:sr-only">{PAUSE_COPY.resume}</span>
            </Key>
            <IconKey
              icon={Ellipsis}
              label={HABITS_COPY.options(habit.name)}
              tooltip={false}
              aria-haspopup="dialog"
              onPointerEnter={onOptionsHover}
              onFocus={onOptionsHover}
              onClick={(event) => onOptions(habit, event.currentTarget)}
            />
          </li>
        ))}
      </ul>
    </FoldedSection>
  );
}
