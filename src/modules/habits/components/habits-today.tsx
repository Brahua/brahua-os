"use client";

import { Ellipsis, Plus, Repeat } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Icon, IconKey, Key } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { deleteHabit, restoreHabit } from "../actions";
import type { DeletedHabit, HabitItem } from "../habit-input";
import { applyHabitListChange, donePatch, neighborOf } from "../habit-list-optimistic";
import { dueOn, todayCount } from "../habit-status";
import { HABITS_COPY } from "../habits-copy";
import { setHabitDone } from "../log-actions";
import { HabitPad, habitPadSelector } from "./habit-pad";
import { failureReason, useHabitsScreen } from "./habits-screen";

// The sheets' code loads on demand: as soon as a key that opens one is pointed at, focused or
// touched, so it is usually there by the time it opens.
const loadForm = () => import("./habit-form-sheet");
const HabitFormSheet = dynamic(() => loadForm().then((loaded) => loaded.HabitFormSheet));
const preloadForm = () => void loadForm();
const loadOptions = () => import("./habit-options-sheet");
const HabitOptionsSheet = dynamic(() => loadOptions().then((loaded) => loaded.HabitOptionsSheet));
const preloadOptions = () => void loadOptions();

type Opening = { habit: HabitItem; key: number };

type HabitsTodayProps = {
  /** The active habits with today's log, in their manual order. */
  habits: HabitItem[];
  /** Id of the page's heading (tabIndex -1): focus goes there when nothing else is left. */
  headingId: string;
};

/**
 * "Hoy" (SPEC-habits "Pantallas"): the pads of the habits due today in their manual order, the
 * live "N de M hoy", "Nuevo hábito" and the empty state. One tap logs the day (optimistic, with
 * "Deshacer" ⌘Z in the notice); everything goes through the screen's save queue, and a refusal
 * or a network failure rolls back with a notice.
 */
export function HabitsToday({ habits, headingId }: HabitsTodayProps) {
  const { today, areas, enqueue, toaster, announce } = useHabitsScreen();
  const { push } = toaster;
  const [view, apply] = useOptimistic(habits, applyHabitListChange);
  const [saving, startSaving] = useTransition();
  const due = dueOn(view, today);
  const count = todayCount(view, today);

  // ── Focus that has to wait for a commit (a pad that appears or leaves) ──
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const selector = pendingFocus.current;
    if (!selector) return;
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return; // Not on screen yet (a created habit before the revalidation lands).
    pendingFocus.current = null;
    element.focus();
  });

  /** Focus `selector` now if it is there, else as soon as it shows up. */
  function focusWhenReady(selector: string) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.focus();
    else pendingFocus.current = selector;
  }

  /** What to focus once `id` leaves: its neighbor's pad, or the page's heading. */
  function neighborElement(id: string): HTMLElement | null {
    const neighbor = neighborOf(due, id);
    return (
      (neighbor ? document.querySelector<HTMLElement>(habitPadSelector(neighbor.id)) : null) ??
      document.getElementById(headingId)
    );
  }

  function notSaved(text: string, reason: string) {
    push({ title: HABITS_COPY.notSavedTitle, text: `${text} ${reason}`, tone: "error" });
  }

  // ── Log today (a tap) and undo ──

  function toggle(habit: HabitItem, done: boolean) {
    // A short buzz where the browser offers it (Android); iOS Safari has no Vibration API.
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
    logDay(habit, done, true);
  }

  /**
   * Marks or unmarks today. `undoable`: a tap (the notice offers "Deshacer"); otherwise it is the
   * undo itself, which is only announced.
   */
  function logDay(habit: HabitItem, done: boolean, undoable: boolean) {
    startSaving(async () => {
      apply({ type: "update", id: habit.id, patch: donePatch(habit, done) });
      const queued = await enqueue(`habit-day:${habit.id}:${today}`, () =>
        setHabitDone({ id: habit.id, day: today, done }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result: ActionResult<HabitItem> =
        queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(undoable ? HABITS_COPY.notLogged : HABITS_COPY.notUndone, failureReason(result));
        return;
      }
      if (undoable) {
        push({
          title: done ? HABITS_COPY.doneTitle : HABITS_COPY.undoneTitle,
          text: done ? HABITS_COPY.done(habit.name) : HABITS_COPY.undone(habit.name),
          action: { label: HABITS_COPY.undo, run: () => logDay(habit, !done, false) },
        });
      } else {
        announce(done ? HABITS_COPY.doneAgain(habit.name) : HABITS_COPY.undoneAgain(habit.name));
      }
    });
  }

  // ── Delete and undo ──

  function remove(habit: HabitItem) {
    const index = view.findIndex((item) => item.id === habit.id);
    startSaving(async () => {
      apply({ type: "remove", id: habit.id });
      const queued = await enqueue(`habit-delete:${habit.id}`, () => deleteHabit({ id: habit.id }));
      if (queued.kind === "skipped" || queued.superseded) return;
      const result: ActionResult<DeletedHabit> =
        queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (result.ok) {
        push({
          title: HABITS_COPY.deletedTitle,
          text: HABITS_COPY.deleted(habit.name),
          action: { label: HABITS_COPY.undo, run: () => restore(habit, index) },
        });
        return;
      }
      notSaved(HABITS_COPY.notDeleted, failureReason(result));
    });
  }

  function restore(habit: HabitItem, index: number) {
    startSaving(async () => {
      apply({ type: "restore", habit, index });
      const queued = await enqueue(`habit-delete:${habit.id}`, () =>
        restoreHabit({ id: habit.id }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (result.ok) announce(HABITS_COPY.restored(habit.name));
      else notSaved(HABITS_COPY.notUndone, failureReason(result));
    });
  }

  // ── Create ──
  const [formOpening, setFormOpening] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const formReturn = useRef<HTMLElement | null>(null);
  const created = useRef<HabitItem | null>(null);

  function openForm(trigger: HTMLElement) {
    formReturn.current = trigger;
    created.current = null;
    // A new key per opening, so the form starts empty every time.
    setFormOpening((value) => value + 1);
    setFormOpen(true);
  }

  function onCreated(habit: HabitItem) {
    created.current = habit;
    setFormOpen(false);
  }

  /** The sheet is gone (and the page no longer `aria-hidden`): focus the new pad and say so. */
  function afterFormClosed() {
    const habit = created.current;
    if (!habit) return;
    created.current = null;
    focusWhenReady(habitPadSelector(habit.id));
    announce(HABITS_COPY.created(habit.name));
  }

  // ── Options (delete; H2–H4 add theirs) ──
  const [options, setOptions] = useState<Opening | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsReturn = useRef<HTMLElement | null>(null);

  function openOptions(habit: HabitItem, trigger: HTMLElement) {
    optionsReturn.current = trigger;
    setOptions((previous) => ({ habit, key: (previous?.key ?? 0) + 1 }));
    setOptionsOpen(true);
  }

  function deleteFromOptions(habit: HabitItem) {
    // The pad (and its options key) leaves: the sheet hands focus to the neighbor instead.
    optionsReturn.current = neighborElement(habit.id);
    setOptionsOpen(false);
    remove(habit);
  }

  /** After a sheet closes: if its return target left meanwhile, focus never stays on <body>. */
  function afterOptionsClosed() {
    if (document.activeElement === document.body || document.activeElement === null) {
      document.getElementById(headingId)?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-6" data-saving={saving ? "" : undefined}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          {/* tabIndex -1: focus lands here when the last pad leaves. */}
          <h1 id={headingId} tabIndex={-1} className="bo-text-display outline-none">
            {HABITS_COPY.title}
          </h1>
          {count.total > 0 ? (
            <p className="bo-text-label text-text-secondary" data-habits-count="">
              {HABITS_COPY.todayCount(count.done, count.total)}
            </p>
          ) : null}
        </div>
        <Key
          variant="signal"
          icon={Plus}
          aria-haspopup="dialog"
          onPointerEnter={preloadForm}
          onFocus={preloadForm}
          onTouchStart={preloadForm}
          onClick={(event) => openForm(event.currentTarget)}
        >
          {HABITS_COPY.newHabit}
        </Key>
      </header>

      {due.length === 0 ? (
        <div className="bo-card max-w-160 items-start">
          <Icon icon={Repeat} size="xl" className="text-text-secondary" />
          <h2 className="bo-text-title">{HABITS_COPY.emptyTitle}</h2>
          <p className="bo-text-body-sm text-text-secondary">{HABITS_COPY.emptyText}</p>
          <Key
            icon={Plus}
            aria-haspopup="dialog"
            onPointerEnter={preloadForm}
            onFocus={preloadForm}
            onTouchStart={preloadForm}
            onClick={(event) => openForm(event.currentTarget)}
          >
            {HABITS_COPY.emptyCreate}
          </Key>
        </div>
      ) : (
        <ul
          aria-label={HABITS_COPY.padsLabel}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {due.map((habit) => (
            <li key={habit.id} className="relative min-w-0" data-habit-cell={habit.id}>
              <HabitPad habit={habit} onToggle={toggle} reserveCorner />
              <div className="absolute top-2 right-2">
                {/* No tooltip: it would repeat the habit's (possibly long) name over the next
                    column and push the page sideways at 320 px; the name is the key's label. */}
                <IconKey
                  icon={Ellipsis}
                  label={HABITS_COPY.options(habit.name)}
                  tooltip={false}
                  aria-haspopup="dialog"
                  onPointerEnter={preloadOptions}
                  onFocus={preloadOptions}
                  onTouchStart={preloadOptions}
                  onClick={(event) => openOptions(habit, event.currentTarget)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* H2 slot ("No tocan hoy (N)", plegado: días fijos de otros días; se registran igual). */}

      {/* H4 slot ("En pausa (N)", plegado, con "Reanudar"). */}

      {formOpening > 0 ? (
        <HabitFormSheet
          key={formOpening}
          open={formOpen}
          onOpenChange={setFormOpen}
          areas={areas}
          returnFocusRef={formReturn}
          onCreated={onCreated}
          onClosed={afterFormClosed}
        />
      ) : null}

      {options ? (
        <HabitOptionsSheet
          key={options.key}
          open={optionsOpen}
          onOpenChange={setOptionsOpen}
          habit={options.habit}
          returnFocusRef={optionsReturn}
          onClosed={afterOptionsClosed}
          onDelete={deleteFromOptions}
        />
      ) : null}
    </div>
  );
}
