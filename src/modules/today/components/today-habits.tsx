"use client";

import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { IconKey, keyClasses } from "@/design-system";
import { HabitPad } from "@/modules/habits/components/habit-pad";
import { HabitsScreenWithin, useHabitsScreen } from "@/modules/habits/components/habits-screen";
import { useDayLog } from "@/modules/habits/components/use-day-log";
import { preloadAdjust, useQuantityLog } from "@/modules/habits/components/use-quantity-log";
import type { HabitItem } from "@/modules/habits/habit-input";
import { applyHabitListChange } from "@/modules/habits/habit-list-optimistic";
import { HABITS_COPY } from "@/modules/habits/habits-copy";
import { HABITS_PATH } from "@/modules/habits/routes";
import { habitsProgress } from "../today-board";
import { TODAY_COPY } from "../today-copy";

/** Id of the section's heading (tabIndex -1): focus lands there if its target left. */
export const TODAY_HABITS_HEADING_ID = "today-habits-title";

/** Only a quantity habit has an exact amount to adjust ("Ajustar el día", like its options). */
const adjustable = (habit: HabitItem) => habit.kind === "build" && habit.measure === "quantity";

type TodayHabitsProps = {
  /** The Lima day the page was read for (YYYY-MM-DD): what a tap logs. */
  today: string;
  /** `getHabitsDueToday(now)`: due today, not paused, in the manual order. */
  habits: HabitItem[];
};

/**
 * "Hábitos" on the board (SPEC-today, D1): the pads of the habits due today, logged exactly as
 * in Hábitos → Hoy (a tap, a quantity's step, a relapse; "Ajustar" for the exact amount; all
 * with "Deshacer"). It reuses `habits`' parts (H6): `HabitsScreenWithin` with the host's queue,
 * notices and announcer (`ScreenServicesProvider` around the board), `useDayLog`,
 * `useQuantityLog` and `HabitPad`. The pads keep the manual order: a done pad never moves under
 * the finger.
 */
export function TodayHabits({ today, habits }: TodayHabitsProps) {
  return (
    // `areas` only feeds the create form, which the board never opens.
    <HabitsScreenWithin today={today} areas={[]}>
      <HabitsGrid habits={habits} />
    </HabitsScreenWithin>
  );
}

function HabitsGrid({ habits }: { habits: HabitItem[] }) {
  const { today, toaster } = useHabitsScreen();
  const [view, apply] = useOptimistic(habits, applyHabitListChange);
  const [saving, startSaving] = useTransition();
  const count = habitsProgress(view, today);

  function notSaved(text: string, reason: string) {
    toaster.push({ title: HABITS_COPY.notSavedTitle, text: `${text} ${reason}`, tone: "error" });
  }

  const { toggle } = useDayLog({ view, apply, startSaving, notSaved });
  const quantity = useQuantityLog({
    view,
    apply,
    startSaving,
    notSaved,
    focusFallback: () => document.getElementById(TODAY_HABITS_HEADING_ID)?.focus(),
  });

  return (
    <section
      aria-labelledby={TODAY_HABITS_HEADING_ID}
      className="flex flex-col gap-3"
      data-today-section="habits"
      data-saving={saving ? "" : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-3">
          <h2 id={TODAY_HABITS_HEADING_ID} tabIndex={-1} className="bo-text-title outline-none">
            {TODAY_COPY.habitsTitle}
          </h2>
          <p className="bo-text-label text-text-secondary" data-today-habits-count="">
            {TODAY_COPY.habitsCount(count.done, count.total)}
            <span className="sr-only">{TODAY_COPY.habitsCountSuffix}</span>
          </p>
        </div>
        <Link href={HABITS_PATH} className={keyClasses({ variant: "ghost" })}>
          {TODAY_COPY.seeHabits}
        </Link>
      </div>

      {/* Same grid as Hábitos → Hoy: 2 columns on the phone. */}
      <ul
        aria-label={TODAY_COPY.habitsList}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      >
        {view.map((habit) => (
          <li key={habit.id} className="relative min-w-0" data-habit-cell={habit.id}>
            <HabitPad
              habit={habit}
              onToggle={toggle}
              onAdd={quantity.add}
              reserveCorner={adjustable(habit)}
            />
            {adjustable(habit) ? (
              // 4 px from the corner, like the options key on /habits. No tooltip: it would
              // repeat the (possibly long) name over the next column at 320 px.
              <div className="absolute top-1 right-1">
                <IconKey
                  icon={SlidersHorizontal}
                  label={TODAY_COPY.adjust(habit.name)}
                  tooltip={false}
                  aria-haspopup="dialog"
                  onPointerEnter={preloadAdjust}
                  onFocus={preloadAdjust}
                  onTouchStart={preloadAdjust}
                  onClick={(event) => quantity.openAdjust(habit, event.currentTarget)}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {quantity.adjustSheet}
    </section>
  );
}
