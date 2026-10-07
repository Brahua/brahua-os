"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { keyClasses } from "@/design-system";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { SwipeRow } from "@/modules/tasks/components/postpone-row";
import { taskFocusSelector, type TaskFocusControl } from "@/modules/tasks/components/task-row";
import { TaskTodayRow, taskTodayCheckSelector } from "@/modules/tasks/components/task-today-row";
import { usePostponePicker } from "@/modules/tasks/components/use-postpone-picker";
import { taskViewHref } from "@/modules/tasks/routes";
import { taskCompletion } from "@/modules/tasks/task-completion";
import { tomorrowOf, type PostponedTask, type PostponeTarget } from "@/modules/tasks/task-postpone";
import { taskPostponement } from "@/modules/tasks/task-postponement";
import type { TaskTodayItem } from "@/modules/tasks/today-summary";
import {
  applyTodayTaskChange,
  completionsDelta,
  focusAfterTaskLeaves,
  taskFold,
  TODAY_HEADING_ID,
  type TodayTaskChange,
} from "../today-board";
import { TODAY_COPY } from "../today-copy";
import { useReportTasks } from "./today-progress";

/** Id of the section's heading (tabIndex -1): focus lands there if its target is gone. */
export const TODAY_TASKS_HEADING_ID = "today-tasks-title";

type TodayTasksProps = {
  /** `getTasksTodaySummary(now)`: overdue and due today, in the "Hoy" view's order. */
  tasks: TaskTodayItem[];
};

/**
 * "Tareas" on the board (SPEC-today, D2): the overdue and due-today tasks, 3 shown and the rest
 * behind "Ver N más" (expanded on this page only). One tap on a checkbox completes a task with
 * `tasks`' own rule (`taskCompletion`: the recurrence, its notice and "Deshacer"), through the
 * board's queue and notices. The row leaves at once and the next folded one rises; focus goes to
 * the next row, else the previous, else the board's heading (the section leaves with its last
 * task). The title links to the task's page. A task that will not happen today moves with
 * "Mañana" (one tap, or a swipe to the left on a touch screen) or "Otro día…" (a date): the row
 * fades out, `tasks`' own `postponeTask` moves it (a recurring task, only this occurrence) and
 * the notice offers "Deshacer"; it is not a completion (it never counts toward "Día completo").
 */
export function TodayTasks({ tasks }: TodayTasksProps) {
  const services = useRequiredScreenServices();
  const { isCurrentDay } = services;
  const completion = useMemo(() => taskCompletion(services), [services]);
  const postponement = useMemo(() => taskPostponement(services), [services]);
  const [view, apply] = useOptimistic(
    tasks,
    (list: TaskTodayItem[], change: TodayTaskChange<TaskTodayItem>) =>
      applyTodayTaskChange(list, change),
  );
  // Rows put back by "Deshacer" whose reopen is still saving: `aria-disabled`, a tap waits.
  const [restoring, markRestoring] = useOptimistic(
    new Set<string>() as ReadonlySet<string>,
    (set: ReadonlySet<string>, id: string) => new Set(set).add(id),
  );
  // Rows moved (or put back) by a postponement whose save is still in flight: they left or came
  // back without being completed or reopened, so "Día completo" doesn't count them.
  const [postponed, markPostponed] = useOptimistic(
    new Set<string>() as ReadonlySet<string>,
    (set: ReadonlySet<string>, id: string) => new Set(set).add(id),
  );
  const [saving, startSaving] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const fold = taskFold(view.length, expanded);
  // "Día completo" (D4) follows this optimistic list (today-progress.tsx): what is still pending,
  // and the completions (or undos) the server's read doesn't have yet.
  useReportTasks({
    pending: view.length,
    doneDelta: completionsDelta(
      tasks.map((task) => task.id),
      view.map((task) => task.id),
      postponed,
    ),
  });

  // ── Focus when a row leaves (after the commit that removed it) ──
  // Selectors in order of preference (the same control of the next row, else its checkbox, else
  // the board's heading).
  const pendingFocus = useRef<string[] | null>(null);
  useEffect(() => {
    const selectors = pendingFocus.current;
    if (!selectors) return;
    pendingFocus.current = null;
    const element =
      selectors
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .find((found) => found !== null) ??
      document.getElementById(TODAY_TASKS_HEADING_ID) ??
      document.getElementById(TODAY_HEADING_ID);
    element?.focus();
  });

  /** Where focus goes when `id` leaves: `control` of the next row first, then its checkbox. */
  function focusTargets(id: string, control: TaskFocusControl): string[] {
    const target = focusAfterTaskLeaves(
      view.map((task) => task.id),
      id,
    );
    if (target.kind !== "row") return [`#${TODAY_HEADING_ID}`];
    return [taskFocusSelector(target.id, control), taskTodayCheckSelector(target.id)];
  }

  /** If focus is in the leaving row (or nowhere: Safari doesn't focus a tapped checkbox). */
  function focusAfterLeaving(id: string, control: TaskFocusControl = "check") {
    const active = document.activeElement;
    const inRow = active?.closest(`[data-task-row="${CSS.escape(id)}"]`);
    if (!inRow && active && active !== document.body) return;
    pendingFocus.current = focusTargets(id, control);
  }

  function complete(task: TaskTodayItem) {
    // A new Lima day with the board open: it is being read again (and said); don't act on the
    // day before's list.
    if (isCurrentDay && !isCurrentDay()) return;
    const index = view.findIndex((item) => item.id === task.id);
    focusAfterLeaving(task.id);
    startSaving(async () => {
      apply({ type: "remove", id: task.id });
      // A failure rolls the row back when this transition ends (useOptimistic).
      await completion.complete(task, () => undo(task, index));
    });
  }

  /** "Deshacer" (the notice's key, ⌘Z / Ctrl+Z): back in its place, pending again. */
  function undo(task: TaskTodayItem, index: number) {
    startSaving(async () => {
      apply({ type: "restore", task, index });
      markRestoring(task.id);
      await completion.reopen(task);
    });
  }

  // ── Postpone ("Mañana", "Otro día…", the swipe) and its undo ──

  /** The task leaves "Hoy" (it moves to a day after today); "Deshacer" brings it back. */
  function postpone(task: TaskTodayItem, to: PostponeTarget, control: TaskFocusControl) {
    if (isCurrentDay && !isCurrentDay()) return;
    const index = view.findIndex((item) => item.id === task.id);
    focusAfterLeaving(task.id, control);
    startSaving(async () => {
      apply({ type: "remove", id: task.id });
      markPostponed(task.id);
      // A failure rolls the row back when this transition ends (useOptimistic).
      await postponement.postpone(task, to, (moved) => undoPostpone(task, index, moved));
    });
  }

  /** "Deshacer" (the notice's key, ⌘Z / Ctrl+Z): back in its place, on exactly the day it had. */
  function undoPostpone(task: TaskTodayItem, index: number, moved: PostponedTask) {
    startSaving(async () => {
      apply({ type: "restore", task, index });
      markPostponed(task.id);
      markRestoring(task.id);
      await postponement.undo(task, moved);
    });
  }

  const picker = usePostponePicker({
    onSave: (task, day) => {
      // The sheet gives focus back to the next row (this one is leaving).
      const [target] = focusTargets(task.id, "pick");
      picker.returnFocus.current =
        document.querySelector<HTMLElement>(target) ??
        document.getElementById(TODAY_TASKS_HEADING_ID);
      const full = view.find((item) => item.id === task.id);
      if (full) postpone(full, day, "pick");
    },
    onClosed: () => {
      if (document.activeElement === document.body || document.activeElement === null) {
        document.getElementById(TODAY_TASKS_HEADING_ID)?.focus();
      }
    },
  });

  // The last task left: the section leaves too (the board drops it on the next read).
  if (view.length === 0) return null;

  return (
    <section
      aria-labelledby={TODAY_TASKS_HEADING_ID}
      className="flex flex-col gap-3"
      data-today-section="tasks"
      data-saving={saving ? "" : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-3">
          <h2 id={TODAY_TASKS_HEADING_ID} tabIndex={-1} className="bo-text-title outline-none">
            {TODAY_COPY.tasksTitle}
          </h2>
          <p className="bo-text-label text-text-secondary" data-today-tasks-count="">
            {TODAY_COPY.tasksCount(view.length)}
            <span className="sr-only">{TODAY_COPY.tasksCountSuffix}</span>
          </p>
        </div>
        <Link href={taskViewHref("hoy")} className={keyClasses({ variant: "ghost" })}>
          {TODAY_COPY.seeTasks}
        </Link>
      </div>

      <ul id={listId} aria-label={TODAY_COPY.tasksList} className="bo-list">
        {view.slice(0, fold.shown).map((task) => (
          <SwipeRow
            key={task.id}
            taskId={task.id}
            swipe
            onSwipe={() => postpone(task, "tomorrow", "postpone")}
          >
            <TaskTodayRow
              task={task}
              onComplete={complete}
              busy={restoring.has(task.id)}
              postpone={{
                onTomorrow: () => postpone(task, "tomorrow", "postpone"),
                onPick: (picked, trigger) => {
                  const tomorrow = tomorrowOf(new Date());
                  picker.openFor(picked, trigger, { minDay: tomorrow, initialDay: tomorrow });
                },
              }}
            />
          </SwipeRow>
        ))}
      </ul>

      {fold.toggle ? (
        <div>
          <button
            type="button"
            aria-expanded={fold.toggle === "less"}
            aria-controls={listId}
            className={keyClasses({ variant: "ghost" })}
            data-today-tasks-fold=""
            onClick={() => setExpanded((value) => !value)}
          >
            {fold.toggle === "more" ? TODAY_COPY.tasksMore(fold.hidden) : TODAY_COPY.tasksLess}
          </button>
        </div>
      ) : null}
      {picker.sheet}
    </section>
  );
}
