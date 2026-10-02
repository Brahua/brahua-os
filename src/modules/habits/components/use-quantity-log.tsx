"use client";

import dynamic from "next/dynamic";
import { useLayoutEffect, useRef, useState, type TransitionStartFunction } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import type { HabitItem } from "../habit-input";
import {
  applyHabitListChange,
  quantityPatch,
  type HabitListChange,
} from "../habit-list-optimistic";
import { isDayDone, todayCount } from "../habit-status";
import { HABITS_COPY } from "../habits-copy";
import { logHabit, setHabitDone, setHabitQuantity } from "../log-actions";
import { FREQUENCY_COPY } from "../frequency-copy";
import { MEASURE_COPY } from "../measure-copy";
import { PAUSE_COPY, STREAK_COPY } from "../pause-copy";
import { otherLoggableDays } from "../schedule";
import { streakMilestone } from "../streak-notice";
import { weekProgress } from "../week-progress";
import type { OtherDay } from "./adjust-day-sheet";
import { failureReason, useHabitsScreen } from "./habits-screen";

// The adjust sheet's code loads on demand (from the options sheet's "Ajustar el día").
const loadAdjust = () => import("./adjust-day-sheet");
const AdjustDaySheet = dynamic(() => loadAdjust().then((loaded) => loaded.AdjustDaySheet));
/** Loads the adjust sheet's code ahead (when "Ajustar el día" is pointed at or focused). */
export const preloadAdjust = () => void loadAdjust();

type QuantityLogArgs = {
  /** The screen's optimistic list (as shown now). */
  view: HabitItem[];
  /** Applies an optimistic change (inside `startSaving`). */
  apply: (change: HabitListChange) => void;
  startSaving: TransitionStartFunction;
  /** Says a save failed ("Sin guardar"), with the server's reason. */
  notSaved: (text: string, reason: string) => void;
  /** Where focus goes if the adjust sheet's return target left meanwhile (never <body>). */
  focusFallback: () => void;
};

/** The sheet open: "Ajustar el día" (today) or, with `days`, "Registrar otro día" (H4). */
type Adjusting = { habit: HabitItem; key: number; days?: OtherDay[] };

/** How a day reads in a notice: "hecho", "recaída registrada", "6 de 8 vasos". */
function dayState(habit: HabitItem): string {
  if (habit.kind === "avoid") {
    return habit.quantity > 0 ? PAUSE_COPY.stateSlip : PAUSE_COPY.stateClean;
  }
  if (habit.measure === "quantity") {
    return PAUSE_COPY.stateQuantity(habit.quantity, habit.target, habit.unit ?? "");
  }
  return habit.quantity > 0 ? PAUSE_COPY.stateDone : PAUSE_COPY.stateNotDone;
}

/** H4: the days "Registrar otro día" offers for a habit, with what each has logged. */
export function otherDaysOf(habit: HabitItem, today: string): OtherDay[] {
  return otherLoggableDays(habit.startDate, today).map((day) => {
    const log = habit.recentLogs.find((entry) => entry.day === day);
    return {
      day,
      quantity: log?.quantity ?? 0,
      target: log?.target ?? habit.goal,
      paused: habit.recentPaused.includes(day),
    };
  });
}

/**
 * H3's logging of quantity habits on a habits screen: a tap adds the step (optimistic, through
 * the screen's queue, with "Deshacer" in the notice) and "Ajustar el día" sets the day's exact
 * quantity. Returns the pad's `add`, `openAdjust` for the options sheet and the adjust sheet to
 * render.
 */
export function useQuantityLog({
  view,
  apply,
  startSaving,
  notSaved,
  focusFallback,
}: QuantityLogArgs) {
  const { today, enqueue, toaster, announce, isCurrentDay } = useHabitsScreen();
  const { push } = toaster;
  // The list as shown now: a notice's "Deshacer" runs long after the render that made it, and
  // must start from what is on screen then (other taps may have happened meanwhile).
  const shownList = useRef(view);
  useLayoutEffect(() => {
    shownList.current = view;
  }, [view]);

  /** The habit as shown now (or as given, if it left the list). */
  function shownHabit(habit: HabitItem): HabitItem {
    return shownList.current.find((item) => item.id === habit.id) ?? habit;
  }

  /**
   * "2 de 3 hoy" as it will be after `change`; a weekly habit adds its week ("2 de 3 esta
   * semana"), as a yes/no tap's notice does.
   */
  function progressAfter(change: HabitListChange & { type: "update" }): string {
    const list = applyHabitListChange(shownList.current, change);
    const after = todayCount(list, today);
    const count = HABITS_COPY.todayCount(after.done, after.total);
    const habit = list.find((item) => item.id === change.id);
    const week = habit ? weekProgress(habit, isDayDone(habit)) : null;
    return week ? `${count}. ${FREQUENCY_COPY.weekProgress(week.done, week.quota)}` : count;
  }

  /**
   * Adds `delta` to today. `undoable`: a tap (the notice offers "Deshacer", which subtracts the
   * same delta); otherwise it is the undo itself, which is only announced. Taps never collapse
   * in the queue (each one counts), so the key is null.
   */
  function addDelta(habit: HabitItem, delta: number, undoable: boolean) {
    // A page read for another Lima day reloads instead of logging the day before.
    if (!isCurrentDay()) return;
    const shown = shownHabit(habit);
    const change = {
      type: "update",
      id: habit.id,
      patch: quantityPatch(shown.quantity, delta),
    } as const;
    // What the tap really adds (0 at the 99 999 ceiling): "Deshacer" takes back only that.
    const applied = (change.patch.quantity ?? shown.quantity) - shown.quantity;
    const progress = progressAfter(change);
    const wasDone = isDayDone(shown);
    // H4: a tap that reaches 7, 30, 90 or 365 (days or weeks) is celebrated in the notice.
    const milestone = undoable ? streakMilestone(shown, { ...shown, ...change.patch }) : null;
    // Two taps in the same frame (before a render) each start from the other's result.
    shownList.current = applyHabitListChange(shownList.current, change);
    startSaving(async () => {
      apply(change);
      const queued = await enqueue(null, () => logHabit({ id: habit.id, day: today, delta }));
      if (queued.kind === "skipped") return;
      const result: ActionResult<HabitItem> =
        queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(undoable ? MEASURE_COPY.notAdded : HABITS_COPY.notUndone, failureReason(result));
        return;
      }
      const saved = result.data;
      const unit = saved.unit ?? "";
      if (!undoable) {
        announce(MEASURE_COPY.addedAgain(saved.name, saved.quantity, saved.target, unit));
        return;
      }
      push({
        title: milestone
          ? STREAK_COPY.milestoneTitle(milestone.count, milestone.unit)
          : !wasDone && isDayDone(saved)
            ? MEASURE_COPY.reachedTitle
            : MEASURE_COPY.addedTitle,
        text: milestone
          ? STREAK_COPY.milestone(saved.name, milestone.count, progress)
          : MEASURE_COPY.added(saved.name, saved.quantity, saved.target, unit, progress),
        action:
          applied === 0
            ? undefined
            : { label: HABITS_COPY.undo, run: () => addDelta(habit, -applied, false) },
      });
    });
  }

  /** One tap of a quantity pad: its step. */
  function add(habit: HabitItem) {
    // A short buzz where the browser offers it (Android); iOS Safari has no Vibration API.
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
    addDelta(habit, habit.step, true);
  }

  /**
   * Sets today's exact quantity ("Ajustar el día"). `previous`: the quantity before, for the
   * notice's "Deshacer" (null: this is the undo, only announced). Same key per day: a newer value
   * sent before the older one ran replaces it.
   */
  function setQuantity(habit: HabitItem, quantity: number, previous: number | null) {
    if (!isCurrentDay()) return;
    const change = { type: "update", id: habit.id, patch: { quantity, hasLogs: true } } as const;
    shownList.current = applyHabitListChange(shownList.current, change);
    startSaving(async () => {
      apply(change);
      const queued = await enqueue(`habit-qty:${habit.id}:${today}`, () =>
        setHabitQuantity({ id: habit.id, day: today, quantity }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result: ActionResult<HabitItem> =
        queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(
          previous === null ? HABITS_COPY.notUndone : MEASURE_COPY.notAdjusted,
          failureReason(result),
        );
        return;
      }
      const saved = result.data;
      const text = MEASURE_COPY.adjusted(
        saved.name,
        saved.quantity,
        saved.target,
        saved.unit ?? "",
      );
      if (previous === null) {
        announce(text);
        return;
      }
      push({
        title: MEASURE_COPY.adjustedTitle,
        text,
        action: { label: HABITS_COPY.undo, run: () => setQuantity(habit, previous, null) },
      });
    });
  }

  // ── "Ajustar el día" sheet ──
  const [adjusting, setAdjusting] = useState<Adjusting | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const adjustReturn = useRef<HTMLElement | null>(null);

  /** Opens the sheet for `habit` (as shown now); focus goes back to `returnTo` on close. */
  function openAdjust(habit: HabitItem, returnTo: HTMLElement | null) {
    adjustReturn.current = returnTo;
    const current = shownHabit(habit);
    setAdjusting((previous) => ({ habit: current, key: (previous?.key ?? 0) + 1 }));
    setAdjustOpen(true);
  }

  /** H4: "Registrar otro día" for `habit` (one of the 7 days before today). */
  function openOtherDay(habit: HabitItem, returnTo: HTMLElement | null) {
    adjustReturn.current = returnTo;
    const current = shownHabit(habit);
    const days = otherDaysOf(current, today);
    setAdjusting((previous) => ({ habit: current, key: (previous?.key ?? 0) + 1, days }));
    setAdjustOpen(true);
  }

  function save(habit: HabitItem, quantity: number, day: OtherDay | null) {
    setAdjustOpen(false);
    if (day) {
      if (quantity !== day.quantity) setOtherDay(habit, day.day, quantity, day.quantity);
      return;
    }
    if (quantity !== habit.quantity) setQuantity(habit, quantity, habit.quantity);
  }

  /**
   * H4: logs an earlier day (within the 7 before today): a quantity's exact amount, or a yes/no
   * (a habit to avoid: a relapse) marked when `quantity` > 0. Not optimistic on "Hoy" (its pads
   * are today's): the page's answer brings the new streaks. `previous`: the day's quantity
   * before, for the notice's "Deshacer" (null: this is the undo, only announced).
   */
  function setOtherDay(habit: HabitItem, day: string, quantity: number, previous: number | null) {
    // A page read for another Lima day reloads: the 7 days moved.
    if (!isCurrentDay()) return;
    const byQuantity = habit.kind === "build" && habit.measure === "quantity";
    startSaving(async () => {
      const queued = byQuantity
        ? await enqueue(`habit-qty:${habit.id}:${day}`, () =>
            setHabitQuantity({ id: habit.id, day, quantity }),
          )
        : await enqueue(`habit-day:${habit.id}:${day}`, () =>
            setHabitDone({ id: habit.id, day, done: quantity > 0 }),
          );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result: ActionResult<HabitItem> =
        queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(
          previous === null ? HABITS_COPY.notUndone : PAUSE_COPY.notLoggedOther,
          failureReason(result),
        );
        return;
      }
      const state = dayState(result.data);
      if (previous === null) {
        announce(PAUSE_COPY.loggedAgain(habit.name, day, state));
        return;
      }
      push({
        title: PAUSE_COPY.loggedTitle,
        text: PAUSE_COPY.logged(habit.name, day, state),
        action: { label: HABITS_COPY.undo, run: () => setOtherDay(habit, day, previous, null) },
      });
    });
  }

  const adjustSheet = adjusting ? (
    <AdjustDaySheet
      key={adjusting.key}
      open={adjustOpen}
      onOpenChange={setAdjustOpen}
      habit={adjusting.habit}
      days={adjusting.days}
      returnFocusRef={adjustReturn}
      onClosed={() => {
        if (document.activeElement === document.body || document.activeElement === null) {
          focusFallback();
        }
      }}
      onSave={save}
    />
  ) : null;

  return { add, openAdjust, openOtherDay, adjustSheet };
}
