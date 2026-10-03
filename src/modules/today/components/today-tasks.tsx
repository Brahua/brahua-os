"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { keyClasses } from "@/design-system";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { TaskTodayRow, taskTodayCheckSelector } from "@/modules/tasks/components/task-today-row";
import { taskViewHref } from "@/modules/tasks/routes";
import { taskCompletion } from "@/modules/tasks/task-completion";
import type { TaskTodayItem } from "@/modules/tasks/today-summary";
import {
  applyTodayTaskChange,
  focusAfterTaskLeaves,
  taskFold,
  TODAY_HEADING_ID,
  type TodayTaskChange,
} from "../today-board";
import { TODAY_COPY } from "../today-copy";

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
 * task). The title links to the task's page; nothing is edited or postponed here.
 */
export function TodayTasks({ tasks }: TodayTasksProps) {
  const services = useRequiredScreenServices();
  const { isCurrentDay } = services;
  const completion = useMemo(() => taskCompletion(services), [services]);
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
  const [saving, startSaving] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const fold = taskFold(view.length, expanded);

  // ── Focus when a row leaves (after the commit that removed it) ──
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const selector = pendingFocus.current;
    if (!selector) return;
    pendingFocus.current = null;
    const element =
      document.querySelector<HTMLElement>(selector) ??
      document.getElementById(TODAY_TASKS_HEADING_ID) ??
      document.getElementById(TODAY_HEADING_ID);
    element?.focus();
  });

  /** If focus is in the leaving row (or nowhere: Safari doesn't focus a tapped checkbox). */
  function focusAfterLeaving(id: string) {
    const active = document.activeElement;
    const inRow = active?.closest(`[data-task-row="${CSS.escape(id)}"]`);
    if (!inRow && active && active !== document.body) return;
    const target = focusAfterTaskLeaves(
      view.map((task) => task.id),
      id,
    );
    pendingFocus.current =
      target.kind === "row" ? taskTodayCheckSelector(target.id) : `#${TODAY_HEADING_ID}`;
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
          <li
            key={task.id}
            data-task-row={task.id}
            className="flex min-w-0 items-start gap-1 bg-surface pr-2"
          >
            <TaskTodayRow task={task} onComplete={complete} busy={restoring.has(task.id)} />
          </li>
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
    </section>
  );
}
