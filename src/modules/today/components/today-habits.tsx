"use client";

import { Ellipsis, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { IconKey, keyClasses } from "@/design-system";
import { HabitPad, habitPadSelector } from "@/modules/habits/components/habit-pad";
import { HabitsScreenWithin, useHabitsScreen } from "@/modules/habits/components/habits-screen";
import { useDayLog } from "@/modules/habits/components/use-day-log";
import type { TrackFocus } from "@/modules/habits/components/use-pause-flow";
import { useSkipToday } from "@/modules/habits/components/use-skip-today";
import { preloadAdjust, useQuantityLog } from "@/modules/habits/components/use-quantity-log";
import { bandListLabel, groupByDaypart, visualOrder } from "@/modules/habits/daypart-groups";
import type { HabitItem } from "@/modules/habits/habit-input";
import { applyHabitListChange, neighborOf } from "@/modules/habits/habit-list-optimistic";
import { isPausedToday } from "@/modules/habits/habit-status";
import { canSkipToday } from "@/modules/habits/skip-day";
import { HABITS_COPY } from "@/modules/habits/habits-copy";
import { HABITS_PATH } from "@/modules/habits/routes";
import { habitsTally, TODAY_HEADING_ID } from "../today-board";
import { TODAY_COPY } from "../today-copy";
import { useReportHabits } from "./today-progress";

/** Id of the section's heading (tabIndex -1): focus lands there if its target left. */
export const TODAY_HABITS_HEADING_ID = "today-habits-title";

// The little options sheet ("Saltar hoy") loads on demand, when its corner key is pointed at.
const loadSkip = () => import("@/modules/habits/components/skip-sheet");
const SkipSheet = dynamic(() => loadSkip().then((loaded) => loaded.SkipSheet));
const preloadSkip = () => void loadSkip();

/** How long focus may still go to a pad that hasn't come back yet (an undone skip). */
const PENDING_FOCUS_MS = 5_000;

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
  const count = habitsTally(view, today);
  // polish: a habit that rests today (a skip, shown at once) leaves the pads and the count.
  const shown = view.filter((habit) => !isPausedToday(habit, today));
  // "Día completo" (D4) follows this optimistic list, not a copy of it (today-progress.tsx).
  useReportHabits(count);

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

  // ── "Saltar hoy": the corner key opens a little sheet; the pad leaves, the notice undoes ──
  const [skipping, setSkipping] = useState<{ habit: HabitItem; key: number } | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const skipReturn = useRef<HTMLElement | null>(null);
  const skipNext = useRef<HabitItem | null>(null);
  // A pad that has to get focus once it is back (an undone skip, a rolled-back one).
  const pendingFocus = useRef<{ id: string; until: number } | null>(null);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (Date.now() > pending.until) {
      pendingFocus.current = null;
      return;
    }
    const pad = document.querySelector<HTMLElement>(habitPadSelector(pending.id));
    if (!pad) return;
    pendingFocus.current = null;
    pad.focus();
  });

  /** Focus on the neighbor of a pad that is leaving, else on the heading (never <body>). */
  function focusNeighbor(id: string) {
    // R4: the neighbor is the one next to it on screen, band by band when the pads are grouped.
    const neighbor = neighborOf(visualOrder(shown), id);
    const pad = neighbor
      ? document.querySelector<HTMLElement>(habitPadSelector(neighbor.id))
      : null;
    // The last pad resting takes the section with it: focus goes to the board's heading.
    (pad ?? document.getElementById(TODAY_HEADING_ID))?.focus();
  }

  /**
   * A pad about to leave or come back: if focus was on it (or on a notice) or lost, it follows.
   * A pad coming back also takes it from another pad: after a skip focus went to its neighbor,
   * and the notice's "Deshacer" hands focus back to that neighbor before it runs.
   */
  const trackFocus: TrackFocus = (habit) => {
    const active = document.activeElement;
    const within = (selector: string) =>
      active instanceof HTMLElement && active.closest(selector) !== null;
    const had =
      active === null ||
      active === document.body ||
      within(`[data-habit-cell="${CSS.escape(habit.id)}"], .bo-toast-viewport`);
    const onAnotherPad = within("[data-habit-cell]") || active?.id === TODAY_HEADING_ID;
    return (moved) => {
      if (isPausedToday(moved, today)) {
        if (had) focusNeighbor(moved.id);
      } else if (had || onAnotherPad) {
        pendingFocus.current = { id: moved.id, until: Date.now() + PENDING_FOCUS_MS };
      }
    };
  };

  const skips = useSkipToday({ view, trackFocus, apply, startSaving, notSaved });

  function openSkip(habit: HabitItem, trigger: HTMLElement) {
    skipReturn.current = trigger;
    skipNext.current = null;
    setSkipping((previous) => ({ habit, key: (previous?.key ?? 0) + 1 }));
    setSkipOpen(true);
  }

  function skipFromSheet(habit: HabitItem) {
    // The pad (and its corner key) leaves: focus goes to its neighbor once the sheet is gone.
    skipReturn.current = null;
    skipNext.current = habit;
    setSkipOpen(false);
  }

  function afterSkipClosed() {
    const habit = skipNext.current;
    if (!habit) return;
    skipNext.current = null;
    if (skips.skip(habit)) focusNeighbor(habit.id);
    else if (document.activeElement === document.body || document.activeElement === null) {
      document.getElementById(TODAY_HABITS_HEADING_ID)?.focus();
    }
  }

  // Nothing due (or all resting): no section, but this component stays mounted (see the board).
  if (shown.length === 0) return null;

  // R4: with a part of the day on any pad, the pads are grouped (Mañana, Tarde, Noche, Sin
  // franja); with none, the same single grid as ever. The band decides the section a pad is in;
  // the hooks, the optimistic list and the pads above do not change owner.
  const bands = groupByDaypart(shown);

  function padCell(habit: HabitItem) {
    return (
      <li key={habit.id} className="relative min-w-0" data-habit-cell={habit.id}>
        <HabitPad
          habit={habit}
          onToggle={toggle}
          onAdd={quantity.add}
          reserveCorner={adjustable(habit) ? "wide" : canSkipToday(habit, today)}
          // The corner key makes the first row taller: 112 px keeps a pad the same height
          // when its streak line appears after a tap (nothing moves under the finger), and
          // every pad of the grid (a habit to avoid has no key) fills its cell alike. Only
          // the board's pads: /habits doesn't pass it.
          className="h-full min-h-28!"
        />
        {/* 4 px from the corner, like the options key on /habits. No tooltip: it would
            repeat the (possibly long) name over the next column at 320 px. */}
        <div className="absolute top-1 right-1 flex gap-1">
          {adjustable(habit) ? (
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
          ) : null}
          {/* A habit to avoid has nothing to rest from: no corner key (decisión autónoma). */}
          {canSkipToday(habit, today) ? (
            <IconKey
              icon={Ellipsis}
              label={HABITS_COPY.options(habit.name)}
              tooltip={false}
              aria-haspopup="dialog"
              onPointerEnter={preloadSkip}
              onFocus={preloadSkip}
              onTouchStart={preloadSkip}
              onClick={(event) => openSkip(habit, event.currentTarget)}
            />
          ) : null}
        </div>
      </li>
    );
  }

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

      {bands ? (
        <div className="flex flex-col gap-4" data-today-habit-bands="">
          {bands.map((band) => (
            <div key={band.key} className="flex flex-col gap-2" data-today-habit-band={band.key}>
              <h3 className="bo-text-label text-text-secondary">{band.label}</h3>
              <ul
                aria-label={bandListLabel(band)}
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              >
                {band.habits.map(padCell)}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        /* Same grid as Hábitos → Hoy: 2 columns on the phone. */
        <ul
          aria-label={TODAY_COPY.habitsList}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {shown.map(padCell)}
        </ul>
      )}

      {quantity.adjustSheet}
      {skipping ? (
        <SkipSheet
          key={skipping.key}
          open={skipOpen}
          onOpenChange={setSkipOpen}
          habit={skipping.habit}
          returnFocusRef={skipReturn}
          onClosed={afterSkipClosed}
          onSkip={skipFromSheet}
        />
      ) : null}
    </section>
  );
}
