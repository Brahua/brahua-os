"use client";

import { ArrowUpDown, CalendarOff, Ellipsis, Plus, Repeat } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Icon, IconKey, Key } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { hasNotice } from "@/lib/toast/queue";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { applyOrder, moveId } from "@/modules/core/life-area-order";
import { deleteHabit, restoreHabit } from "../actions";
import type { DeletedHabit, HabitItem } from "../habit-input";
import { applyHabitListChange, donePatch, neighborOf } from "../habit-list-optimistic";
import { dueOn, todayCount } from "../habit-status";
import { HABITS_COPY } from "../habits-copy";
import { setHabitDone } from "../log-actions";
import { archiveHabit, reorderHabits, unarchiveHabit } from "../organize-actions";
import { ORGANIZE_COPY } from "../organize-copy";
import { isScheduledOn } from "../schedule";
import { FREQUENCY_COPY } from "../frequency-copy";
import { weekProgress } from "../week-progress";
import { HabitOrderContext, PlainHabitOrder, type HabitOrderListProps } from "./habit-order-rows";
import { HabitPad, habitPadSelector } from "./habit-pad";
import { ArchivedHabits, FoldedSection, reactivateSelector } from "./habit-sections";
import { failureReason, useHabitsScreen } from "./habits-screen";

// The sheets' code loads on demand: as soon as a key that opens one is pointed at, focused or
// touched, so it is usually there by the time it opens.
const loadForm = () => import("./habit-form-sheet");
const HabitFormSheet = dynamic(() => loadForm().then((loaded) => loaded.HabitFormSheet));
const preloadForm = () => void loadForm();
const loadOptions = () => import("./habit-options-sheet");
const HabitOptionsSheet = dynamic(() => loadOptions().then((loaded) => loaded.HabitOptionsSheet));
const preloadOptions = () => void loadOptions();
// dnd-kit only loads in the browser, once "Ordenar" is pressed: until then (and on the server)
// the plain list with the same rows and working Subir/Bajar keys stands in.
const SortableHabits = dynamic(() => import("./sortable-habits"), {
  ssr: false,
  loading: () => <PlainHabitOrder />,
});

type Opening = { habit: HabitItem; key: number };

/** Where a pad is: the grid of the habits due today, or "No tocan hoy". */
type Grid = "due" | "not-due";

/** A habit's pad inside one grid (a pad moves between them when its frequency changes). */
const padIn = (grid: Grid, id: string) => `[data-habits-grid="${grid}"] ${habitPadSelector(id)}`;

/** How long focus may still go to a pad that hasn't appeared yet (a created habit). */
const PENDING_FOCUS_MS = 5_000;
const pendingFocusExpiry = () => Date.now() + PENDING_FOCUS_MS;

/** Whether focus can land on it (not inside a folded section). */
const isShown = (element: HTMLElement) => element.closest("[hidden]") === null;

type HabitsTodayProps = {
  /** The active habits with today's log, in their manual order. */
  habits: HabitItem[];
  /** H2: the archived habits ("Archivados", with "Reactivar"). */
  archived?: HabitItem[];
  /** Id of the page's heading (tabIndex -1): focus goes there when nothing else is left. */
  headingId: string;
};

/**
 * "Hoy" (SPEC-habits "Pantallas"): the pads of the habits due today in their manual order, the
 * live "N de M hoy", "Nuevo hábito" and the empty state; H2: "Nada toca hoy", the folded "No
 * tocan hoy (N)" (logged the same way), "Ordenar" and the folded "Archivados (N)". One tap logs
 * the day (optimistic, with "Deshacer" ⌘Z in the notice); everything goes through the screen's
 * save queue, and a refusal or a network failure rolls back with a notice.
 */
export function HabitsToday({ habits, archived = [], headingId }: HabitsTodayProps) {
  const { today, areas, enqueue, toaster, announce, isCurrentDay } = useHabitsScreen();
  const { push } = toaster;
  const [view, apply] = useOptimistic(habits, applyHabitListChange);
  const [archivedView, applyArchived] = useOptimistic(archived, applyHabitListChange);
  const [saving, startSaving] = useTransition();
  const reducedMotion = usePrefersReducedMotion();
  const due = dueOn(view, today);
  const notDue = view.filter((habit) => !isScheduledOn(habit, today));
  const count = todayCount(view, today);
  const listHeadingId = `${headingId}-today`;
  const [notDueOpen, setNotDueOpen] = useState(false);
  const [ordering, setOrdering] = useState(false);
  // Ordering needs two habits. Down to one while ordering (deleted in another tab), the mode
  // ends (adjusted during render, so it never comes back by itself) and focus, which was on the
  // "Ordenar" key that just left, goes to the heading (never <body>).
  const fewerThanTwo = view.length < 2;
  if (ordering && fewerThanTwo) setOrdering(false);
  const isOrdering = ordering && !fewerThanTwo;
  const wasOrdering = useRef(false);
  useEffect(() => {
    if (isOrdering) {
      wasOrdering.current = true;
      return;
    }
    if (!wasOrdering.current) return;
    wasOrdering.current = false;
    const lost = document.activeElement === document.body || document.activeElement === null;
    if (fewerThanTwo && lost) document.getElementById(headingId)?.focus();
  }, [isOrdering, fewerThanTwo, headingId]);

  // The lists as last rendered, for undo actions that run from an older notice.
  const latest = useRef(view);
  useLayoutEffect(() => {
    latest.current = view;
  });

  // ── Focus that has to wait for a commit (a created habit's pad, before its revalidation) ──
  // Expires: if the pad never shows up (a failed revalidation), a later render must not take
  // focus away from wherever the person went meanwhile.
  const pendingFocus = useRef<{ selector: string; until: number } | null>(null);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (Date.now() > pending.until) {
      pendingFocus.current = null;
      return;
    }
    const element = document.querySelector<HTMLElement>(pending.selector);
    if (!element || !isShown(element)) return;
    pendingFocus.current = null;
    element.focus();
  });

  /**
   * Focus `selector` now if it is there; otherwise the heading for now (never <body>) and
   * `selector` as soon as it shows up (within a few seconds).
   */
  function focusWhenReady(selector: string) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element && isShown(element)) {
      element.focus();
      return;
    }
    document.getElementById(headingId)?.focus();
    pendingFocus.current = { selector, until: pendingFocusExpiry() };
  }

  /** The grid a habit's pad is in today. */
  const gridOf = (habit: HabitItem): Grid => (isScheduledOn(habit, today) ? "due" : "not-due");

  /** What to focus once `id` leaves: its neighbor's pad in the same grid, or the heading. */
  function neighborElement(id: string): HTMLElement | null {
    const grid = due.some((habit) => habit.id === id) ? due : notDue;
    const neighbor = neighborOf(grid, id);
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
    // The page was read for another Lima day (left open past midnight): reload it instead of
    // logging the day before by mistake (isCurrentDay refreshes and says so).
    if (!isCurrentDay()) return;
    const change = { type: "update", id: habit.id, patch: donePatch(done) } as const;
    // The count as it will be after this tap ("2 de 3 hoy"), said in the notice too.
    const after = todayCount(applyHabitListChange(view, change), today);
    // A weekly habit says its week too ("2 de 3 hoy. 2 de 3 esta semana"): its pad's line is
    // only in its description, which isn't read again after the tap.
    const week = weekProgress(habit, done);
    const progress = week
      ? `${HABITS_COPY.todayCount(after.done, after.total)}. ${FREQUENCY_COPY.weekProgress(week.done, week.quota)}`
      : HABITS_COPY.todayCount(after.done, after.total);
    startSaving(async () => {
      apply(change);
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
          text: done
            ? HABITS_COPY.done(habit.name, progress)
            : HABITS_COPY.undone(habit.name, progress),
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

  // ── Archive and reactivate (H2) ──

  /**
   * Out of "Hoy" into "Archivados" at once. `undoable`: from the options (the notice offers
   * "Deshacer", which puts it back in its place); otherwise the undo of a "Reactivar".
   */
  function archive(habit: HabitItem, undoable: boolean) {
    const index = latest.current.findIndex((item) => item.id === habit.id);
    startSaving(async () => {
      apply({ type: "remove", id: habit.id });
      applyArchived({ type: "restore", habit, index: 0 });
      const queued = await enqueue(`habit-archive:${habit.id}`, () =>
        archiveHabit({ id: habit.id }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(
          undoable ? ORGANIZE_COPY.notArchived : HABITS_COPY.notUndone,
          failureReason(result),
        );
        return;
      }
      if (undoable) {
        push({
          title: ORGANIZE_COPY.archivedNoticeTitle,
          text: ORGANIZE_COPY.archivedNotice(habit.name),
          action: { label: HABITS_COPY.undo, run: () => reactivate(habit, index) },
        });
      } else {
        announce(ORGANIZE_COPY.archivedAgain(habit.name));
      }
    });
  }

  /**
   * Back into "Hoy" at once: at the end ("Reactivar", `index` null: the notice offers
   * "Deshacer") or at `index`, its old place (the undo of an archive, only announced).
   */
  function reactivate(habit: HabitItem, index: number | null) {
    const undoable = index === null;
    startSaving(async () => {
      applyArchived({ type: "remove", id: habit.id });
      apply({ type: "restore", habit, index: index ?? Number.MAX_SAFE_INTEGER });
      const position = undoable ? "end" : "original";
      const queued = await enqueue(`habit-archive:${habit.id}`, () =>
        unarchiveHabit({ id: habit.id, position }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(
          undoable ? ORGANIZE_COPY.notReactivated : HABITS_COPY.notUndone,
          failureReason(result),
        );
        return;
      }
      if (undoable) {
        push({
          title: ORGANIZE_COPY.reactivatedTitle,
          text: ORGANIZE_COPY.reactivated(habit.name),
          action: { label: HABITS_COPY.undo, run: () => archive(habit, false) },
        });
      } else {
        announce(ORGANIZE_COPY.backInPlace(habit.name));
      }
    });
  }

  /** "Reactivar" in "Archivados": focus to the next archived one, else to the habit's pad. */
  function reactivateFromList(habit: HabitItem) {
    const index = archivedView.findIndex((item) => item.id === habit.id);
    const neighbor = archivedView[index + 1] ?? archivedView[index - 1];
    // The last one, not due today: "No tocan hoy" opens so its pad can take focus.
    if (!neighbor && gridOf(habit) === "not-due") setNotDueOpen(true);
    reactivate(habit, null);
    focusWhenReady(neighbor ? reactivateSelector(neighbor.id) : padIn(gridOf(habit), habit.id));
  }

  // ── Manual order (H2) ──
  // Consecutive moves share one notice; its "Deshacer" restores the order before the first.
  // `moves` counts the moves in the burst, so a failure knows whether a later one exists.
  const reorderBurst = useRef<{ noticeId: string; before: string[]; moves: number } | null>(null);
  const noticeSerial = useRef(0);

  function move(id: string, to: number) {
    const ids = view.map((habit) => habit.id);
    const from = ids.indexOf(id);
    if (from === -1 || from === to) return;
    const next = moveId(ids, from, to);
    const habit = view[from];
    const current = reorderBurst.current;
    const burst =
      current && hasNotice(toaster.state, current.noticeId)
        ? current
        : { noticeId: `habit-order-${++noticeSerial.current}`, before: ids, moves: 0 };
    reorderBurst.current = burst;
    const step = ++burst.moves;
    toaster.replace({
      id: burst.noticeId,
      title: ORGANIZE_COPY.orderNoticeTitle,
      text: ORGANIZE_COPY.moved(habit.name, ORGANIZE_COPY.position(to, next.length)),
      action: { label: HABITS_COPY.undo, run: () => restoreOrder(burst.before) },
    });
    saveOrder(next, {
      failure: ORGANIZE_COPY.orderFailed,
      onFailure: () => {
        // Only if this was the burst's last move: a later one may still be on its way, or
        // saved, and its "Deshacer" must stay.
        if (step !== burst.moves) return;
        toaster.dismiss(burst.noticeId);
        if (reorderBurst.current === burst) reorderBurst.current = null;
      },
    });
  }

  function restoreOrder(before: string[]) {
    reorderBurst.current = null;
    // The order from before the moves, over today's habits: one created or reactivated since
    // goes last, one archived or deleted since is left out (the list sent is the active set).
    const ids = applyOrder(latest.current, before).map((habit) => habit.id);
    saveOrder(ids, {
      failure: HABITS_COPY.notUndone,
      onSuccess: () =>
        push({ title: ORGANIZE_COPY.undoneTitle, text: ORGANIZE_COPY.orderRestored }),
    });
  }

  /** Applies an order at once and saves it; on failure it rolls back and says `failure` and why. */
  function saveOrder(
    ids: string[],
    {
      failure,
      onFailure,
      onSuccess,
    }: { failure: string; onFailure?: () => void; onSuccess?: () => void },
  ) {
    startSaving(async () => {
      apply({ type: "reorder", ids });
      // No key: every step is sent (each one matters for its undo).
      const queued = await enqueue(null, () => reorderHabits({ ids }));
      const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (result.ok) {
        onSuccess?.();
        return;
      }
      onFailure?.();
      notSaved(failure, failureReason(result));
    });
  }

  const orderProps: HabitOrderListProps = { habits: view, reducedMotion, onMove: move };

  // ── Create and edit ──
  const [formOpening, setFormOpening] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [formHabit, setFormHabit] = useState<HabitItem | null>(null);
  const formReturn = useRef<HTMLElement | null>(null);
  const created = useRef<HabitItem | null>(null);

  /** Opens the form: empty ("Nuevo hábito") or, with `habit`, to edit it. */
  function openForm(trigger: HTMLElement | null, habit: HabitItem | null = null) {
    formReturn.current = trigger;
    created.current = null;
    setFormHabit(habit);
    // A new key per opening, so the form starts empty (or from the habit) every time.
    setFormOpening((value) => value + 1);
    setFormOpen(true);
  }

  function onSaved(habit: HabitItem) {
    created.current = habit;
    setFormOpen(false);
  }

  /** The sheet is gone (and the page no longer `aria-hidden`): focus the pad and say so. */
  function afterFormClosed() {
    const habit = created.current;
    if (!habit) return;
    created.current = null;
    // Not due today (fixed days of another day): "No tocan hoy" opens, so the pad can be seen.
    const grid = gridOf(habit);
    if (grid === "not-due") setNotDueOpen(true);
    focusWhenReady(padIn(grid, habit.id));
    const message = formHabit ? ORGANIZE_COPY.updated(habit.name) : HABITS_COPY.created(habit.name);
    // Its pad moved to the folded section (or was born there): say where it is.
    announce(grid === "not-due" ? `${message} ${ORGANIZE_COPY.nowNotDue}` : message);
  }

  // ── Options (edit, archive, delete; H3–H4 add theirs) ──
  const [options, setOptions] = useState<Opening | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsReturn = useRef<HTMLElement | null>(null);
  // "Editar" closes the options first; the form opens once they are gone (one dialog at a time).
  const editAfterOptions = useRef<HabitItem | null>(null);

  function openOptions(habit: HabitItem, trigger: HTMLElement) {
    optionsReturn.current = trigger;
    editAfterOptions.current = null;
    setOptions((previous) => ({ habit, key: (previous?.key ?? 0) + 1 }));
    setOptionsOpen(true);
  }

  function deleteFromOptions(habit: HabitItem) {
    // The pad (and its options key) leaves: the sheet hands focus to the neighbor instead.
    optionsReturn.current = neighborElement(habit.id);
    setOptionsOpen(false);
    remove(habit);
  }

  function archiveFromOptions(habit: HabitItem) {
    optionsReturn.current = neighborElement(habit.id);
    setOptionsOpen(false);
    archive(habit, true);
  }

  function editFromOptions(habit: HabitItem) {
    editAfterOptions.current = habit;
    setOptionsOpen(false);
  }

  /** After a sheet closes: if its return target left meanwhile, focus never stays on <body>. */
  function afterOptionsClosed() {
    const editing = editAfterOptions.current;
    if (editing) {
      editAfterOptions.current = null;
      // Back to the options key when the form closes without saving.
      openForm(optionsReturn.current, latest.current.find((h) => h.id === editing.id) ?? editing);
      return;
    }
    if (document.activeElement === document.body || document.activeElement === null) {
      document.getElementById(headingId)?.focus();
    }
  }

  /** A grid of pads, each with its options key on the corner. */
  function padGrid(list: HabitItem[], grid: Grid, label: { id?: string; text?: string }) {
    return (
      <ul
        aria-labelledby={label.id}
        aria-label={label.text}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        data-habits-grid={grid}
      >
        {list.map((habit) => (
          <li key={habit.id} className="relative min-w-0" data-habit-cell={habit.id}>
            <HabitPad habit={habit} onToggle={toggle} reserveCorner />
            {/* 4 px from the corner: a tap that misses the key by a little hits it, not the pad. */}
            <div className="absolute top-1 right-1">
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
    );
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
        <div className="flex flex-wrap gap-2">
          {view.length > 1 ? (
            <Key icon={ArrowUpDown} toggle pressed={isOrdering} onPressedChange={setOrdering}>
              {ORGANIZE_COPY.order}
            </Key>
          ) : null}
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
        </div>
      </header>

      {isOrdering ? (
        <section aria-labelledby={`${headingId}-order`} className="flex flex-col gap-3">
          <h2 id={`${headingId}-order`} className="bo-text-title">
            {ORGANIZE_COPY.orderTitle}
          </h2>
          <p className="bo-text-body-sm max-w-160 text-text-secondary">{ORGANIZE_COPY.orderHelp}</p>
          <HabitOrderContext value={orderProps}>
            <SortableHabits {...orderProps} />
          </HabitOrderContext>
        </section>
      ) : view.length === 0 ? (
        // No habits at all (with habits but none due today, "Nada toca hoy" below).
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
        <>
          <section aria-labelledby={listHeadingId} className="flex flex-col gap-3">
            {/* A heading of its own (read by screen readers), so the sections below ("No tocan
                hoy", H4's "En pausa") sit next to it at the same level. */}
            <h2 id={listHeadingId} className="sr-only">
              {HABITS_COPY.padsLabel}
            </h2>

            {/* H2: there are habits, but none is due today. */}
            {due.length === 0 ? (
              <div className="bo-card max-w-160 items-start" data-habits-nothing-today="">
                <Icon icon={CalendarOff} size="xl" className="text-text-secondary" />
                <p className="bo-text-title">{ORGANIZE_COPY.nothingTodayTitle}</p>
                <p className="bo-text-body-sm text-text-secondary">
                  {ORGANIZE_COPY.nothingTodayText}
                </p>
              </div>
            ) : null}

            {due.length > 0 ? padGrid(due, "due", { id: listHeadingId }) : null}
          </section>

          {/* H2: "No tocan hoy (N)", folded: fixed days of other days, logged the same way. */}
          {notDue.length > 0 ? (
            <FoldedSection
              title={ORGANIZE_COPY.notDueTitle}
              count={notDue.length}
              expanded={notDueOpen}
              onExpandedChange={setNotDueOpen}
              name="not-due"
            >
              <p className="bo-text-body-sm max-w-160 text-text-secondary">
                {ORGANIZE_COPY.notDueHelp}
              </p>
              {padGrid(notDue, "not-due", { text: ORGANIZE_COPY.notDueList })}
            </FoldedSection>
          ) : null}
        </>
      )}

      {/* H4 slot ("En pausa (N)", plegado, con "Reanudar"). */}

      {/* H2: "Archivados (N)", folded, with "Reactivar" (H5 moves it to "Semana"). */}
      {isOrdering ? null : (
        <ArchivedHabits habits={archivedView} onReactivate={reactivateFromList} />
      )}

      {formOpening > 0 ? (
        <HabitFormSheet
          key={formOpening}
          open={formOpen}
          onOpenChange={setFormOpen}
          areas={areas}
          habit={formHabit}
          returnFocusRef={formReturn}
          onCreated={onSaved}
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
          onEdit={editFromOptions}
          onArchive={archiveFromOptions}
        />
      ) : null}
    </div>
  );
}
