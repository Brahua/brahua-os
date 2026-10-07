"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { deleteTask, editTask } from "../actions";
import {
  placementName,
  placementPatch,
  placementValue,
  toPlacement,
  type PlacementValue,
} from "../placement";
import type { SpawnUndo } from "../recurrence-db";
import type { DeletedTask, TaskItem, TaskPlacement } from "../task-input";
import { applyTaskListChange, neighborOf } from "../task-list-optimistic";
import { groupRuns, type TaskGroup } from "../task-views";
import { TASK_FIELD_NAMES, TASKS_COPY } from "../tasks-copy";
import { VIEWS_COPY } from "../views-copy";
import { completedNotice, reopenedNotice, restoredNotice } from "../recurrence-notices";
import {
  completeTaskWithNext,
  reopenTaskWithSpawn,
  restoreTaskWithSpawn,
} from "../recurrence-actions";
import { taskCompletion } from "../task-completion";
import { settled } from "../task-failure";
import { postponeDay, tomorrowOf, type PostponedTask, type PostponeTarget } from "../task-postpone";
import { taskPostponement } from "../task-postponement";
import { limaToday } from "../task-views";
import { SwipeRow } from "./swipe-row";
import { useSwipeEnabled } from "./use-swipe-enabled";
import { TaskRow, taskFocusSelector, type TaskFocusControl } from "./task-row";
import { failureReason, useTasksScreen } from "./tasks-screen";
import { usePostponePicker } from "./use-postpone-picker";

// The sheets' code loads on their first opening.
const loadClassify = () => import("./classify-sheet");
const ClassifySheet = dynamic(() => loadClassify().then((loaded) => loaded.ClassifySheet));
const loadDetail = () => import("./detail/task-detail-sheet");
const TaskDetailSheet = dynamic(() => loadDetail().then((loaded) => loaded.TaskDetailSheet));

type TaskListProps = {
  tasks: TaskItem[];
  /** Name of the list (e.g. "Tareas en la bandeja"). */
  label: string;
  /** Whether a task still belongs to this view after a change (the inbox: unclassified, pending). */
  belongs: (task: TaskItem) => boolean;
  /** The inbox's quick action ("Clasificar") on every row. */
  classify?: boolean;
  /** Id of an element with tabIndex -1 (the view's heading): focus goes there when the list empties. */
  fallbackFocusId: string;
  /** Shown when the list is empty. */
  empty: React.ReactNode;
  /**
   * Drawn above the list with the number of tasks it shows right now (optimistic: a completed
   * row leaves the count at once). The view's heading, with its count.
   */
  header?: (count: number) => React.ReactNode;
  /**
   * Groups consecutive rows under a heading (h3) each, in the list's order ("Próximas": by
   * day). Without it, one flat list.
   */
  groupOf?: (task: TaskItem) => TaskGroup;
  /** Every row gets a visible "Deshacer" that reopens it ("Hechas"). */
  reopenable?: boolean;
  /**
   * Pending rows get "Mañana" and "Otro día…" (and, on a touch screen, the swipe to the left that
   * does "Mañana"): the due date moves, the row leaves if it no longer belongs, and the notice
   * offers "Deshacer". The date views and "Todas" turn it on.
   */
  postpone?: boolean;
  /**
   * T5 (a project's "Tareas"): rows leave out the area and project (the page is the project's),
   * get an extra control after the row (`rowAction`, the next-action mark), and "Deshacer" of a
   * completion can go through another call (`undoCompletion`: for the next action, reopen and
   * mark it again in one transaction). Return null to use the plain reopen.
   */
  hidePlacement?: boolean;
  rowAction?: (task: TaskItem) => React.ReactNode;
  undoCompletion?: (
    task: TaskItem,
  ) => (() => Promise<ActionResult<{ spawn: SpawnUndo | null }>>) | null;
};

type Opening = { task: TaskItem; key: number };

/**
 * A list of tasks with the row actions (SPEC-tasks "Cada fila"): one tap completes (optimistic,
 * "Deshacer" in the notice), the title opens the detail (a side sheet on the desktop, the task's
 * page on the phone) and, in the inbox, "Clasificar" moves it or deletes it. Everything goes
 * through the screen's save queue; a refusal or a network failure rolls back with a notice.
 *
 * When a row leaves the list, focus goes to the next row's checkbox (or the previous one, or the
 * view's heading), never to <body>.
 */
export function TaskList({
  tasks,
  label,
  belongs,
  classify = false,
  fallbackFocusId,
  empty,
  header,
  groupOf,
  reopenable = false,
  postpone = false,
  hidePlacement = false,
  rowAction,
  undoCompletion,
}: TaskListProps) {
  const groupIds = useId();
  const { now, targets, enqueue, toaster, announce } = useTasksScreen();
  const { push } = toaster;
  const isDesktop = useIsDesktop();
  const [view, apply] = useOptimistic(tasks, applyTaskListChange);
  const [saving, startSaving] = useTransition();
  // Completing and undoing with the notices of every task list (also `today`'s, D2).
  const completion = useMemo(
    () => taskCompletion({ enqueue, toaster, announce }),
    [enqueue, toaster, announce],
  );
  const swipe = useSwipeEnabled();
  const postponement = useMemo(
    () => taskPostponement({ enqueue, toaster, announce }),
    [enqueue, toaster, announce],
  );

  // ── Focus when a row leaves ──
  // Selectors in order of preference (a control of the neighbor, its checkbox, the heading).
  const pendingFocus = useRef<string[] | null>(null);
  useEffect(() => {
    const selectors = pendingFocus.current;
    if (!selectors) return;
    pendingFocus.current = null;
    const element =
      selectors
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .find((found) => found !== null) ?? document.getElementById(fallbackFocusId);
    element?.focus();
  });

  /** The element to focus once `id` leaves (its neighbor's checkbox, or the heading). */
  function neighborElement(id: string): HTMLElement | null {
    const neighbor = neighborOf(view, id);
    const selector = neighbor ? taskFocusSelector(neighbor.id, "check") : null;
    return (
      (selector ? document.querySelector<HTMLElement>(selector) : null) ??
      document.getElementById(fallbackFocusId)
    );
  }

  /**
   * Moves focus to the neighbor after the commit, if focus was in the leaving row (or nowhere):
   * to the same kind of control that was used (its checkbox, or its "Deshacer" in "Hechas").
   */
  function focusAfterLeaving(id: string, control: TaskFocusControl = "check") {
    const active = document.activeElement;
    const inRow = active?.closest(`[data-task-row="${CSS.escape(id)}"]`);
    if (!inRow && active && active !== document.body) return;
    const neighbor = neighborOf(view, id);
    pendingFocus.current = neighbor
      ? [taskFocusSelector(neighbor.id, control), taskFocusSelector(neighbor.id, "check")]
      : [`#${CSS.escape(fallbackFocusId)}`];
  }

  /** After a sheet closes: if its return target left meanwhile, focus never stays on <body>. */
  function afterSheetClosed() {
    if (document.activeElement === document.body || document.activeElement === null) {
      document.getElementById(fallbackFocusId)?.focus();
    }
  }

  function notSaved(text: string, reason: string) {
    push({ title: TASKS_COPY.notSavedTitle, text: `${text} ${reason}`, tone: "error" });
  }

  // ── Complete and undo ──

  /**
   * Completing and reopening outside `taskCompletion` (which the checkbox and "Deshacer" of a
   * completion use): "Hechas" and the notice that undoes it. Every path goes through
   * `completeTaskWithNext` / `reopenTaskWithSpawn` (T3) with the same queue key.
   */
  function runComplete(task: TaskItem) {
    // T3: the completion's next occurrence (a recurring task) comes back with it.
    return enqueue(`task-done:${task.id}`, () => completeTaskWithNext({ id: task.id }));
  }

  function runReopen(task: TaskItem) {
    // T3: says whether the next occurrence was removed with the undo or kept (edited).
    return enqueue(`task-done:${task.id}`, () => reopenTaskWithSpawn({ id: task.id }));
  }

  function toggle(task: TaskItem, done: boolean) {
    if (!done) {
      reopenFromRow(task, "check");
      return;
    }
    const index = view.findIndex((item) => item.id === task.id);
    const completed: TaskItem = { ...task, doneAt: new Date() };
    const leaves = !belongs(completed);
    if (leaves) focusAfterLeaving(task.id);
    startSaving(async () => {
      apply(
        leaves
          ? { type: "remove", id: task.id }
          : { type: "update", id: task.id, patch: { doneAt: completed.doneAt } },
      );
      await completion.complete(task, () => reopen(task, index));
    });
  }

  /**
   * Unchecking a done row (or its "Deshacer" in "Hechas"): pending again. Where pending tasks
   * don't belong ("Hechas"), the row leaves, with a notice whose "Deshacer" completes it again.
   */
  function reopenFromRow(task: TaskItem, control: TaskFocusControl) {
    const index = view.findIndex((item) => item.id === task.id);
    const reopened: TaskItem = { ...task, doneAt: null };
    if (belongs(reopened)) {
      reopen(task, index);
      return;
    }
    focusAfterLeaving(task.id, control);
    startSaving(async () => {
      apply({ type: "remove", id: task.id });
      const result = settled(await runReopen(task));
      if (result === "stale") return;
      if (result.ok) {
        push({
          title: VIEWS_COPY.reopenedTitle,
          text: reopenedNotice(task, result.data.spawn),
          action: { label: TASKS_COPY.undo, run: () => completeAgain(task, index) },
        });
        return;
      }
      notSaved(TASKS_COPY.notCompleted, failureReason(result));
    });
  }

  /** "Deshacer" of a reopen from "Hechas": done again, back in its place. */
  function completeAgain(task: TaskItem, index: number) {
    startSaving(async () => {
      apply({ type: "restore", task, index });
      const result = settled(await runComplete(task));
      if (result === "stale") return;
      if (result.ok)
        announce(
          result.data.next
            ? completedNotice(task, result.data.next, result.data.nextInbox)
            : VIEWS_COPY.completedAgain(task.title),
        );
      else notSaved(TASKS_COPY.notUndone, failureReason(result));
    });
  }

  function reopen(task: TaskItem, index: number) {
    startSaving(async () => {
      const reopened: TaskItem = { ...task, doneAt: null };
      // "Deshacer" of a completion: back in its place, unless pending tasks don't belong here.
      if (belongs(reopened)) apply({ type: "restore", task: reopened, index });
      else apply({ type: "remove", id: task.id });
      const custom = undoCompletion?.(task);
      if (!custom) {
        // T3: says whether the next occurrence went away with the undo or stayed (edited).
        await completion.reopen(task);
        return;
      }
      const result = settled(await enqueue(`task-done:${task.id}`, custom));
      if (result === "stale") return;
      if (result.ok) announce(reopenedNotice(task, result.data.spawn));
      else notSaved(TASKS_COPY.notUndone, failureReason(result));
    });
  }

  // ── Postpone ("Mañana", "Otro día…", the swipe) and undo ──

  /**
   * Moves the due date. The row leaves if it no longer belongs to this view (the "Hoy" view
   * after "Mañana"); otherwise it stays with its new day. "Deshacer" puts back exactly the day it
   * had (`previousDueDate`), and the row where it was.
   */
  function postponeRow(task: TaskItem, to: PostponeTarget, control: TaskFocusControl) {
    const day = postponeDay(to, now);
    if (day === null || day === task.dueDate) return;
    const index = view.findIndex((item) => item.id === task.id);
    const moved: TaskItem = { ...task, dueDate: day };
    const leaves = !belongs(moved);
    if (leaves) focusAfterLeaving(task.id, control);
    else keepFocusOn(task.id, control);
    startSaving(async () => {
      apply(
        leaves
          ? { type: "remove", id: task.id }
          : { type: "reschedule", id: task.id, dueDate: day },
      );
      await postponement.postpone(task, to, (result) => undoPostpone(task, index, result, leaves));
    });
  }

  /**
   * The row stays but may change group ("Próximas" draws each day in its own list), which
   * remounts it: its control gets focus back after the commit (the sheet's "Otro día…" does it
   * when it closes).
   */
  function keepFocusOn(id: string, control: TaskFocusControl) {
    const selector = taskFocusSelector(id, control);
    if (control === "pick") {
      sheetFocus.current = selector;
      return;
    }
    const active = document.activeElement;
    if (active?.closest(`[data-task-row="${CSS.escape(id)}"]`)) pendingFocus.current = [selector];
  }

  function undoPostpone(task: TaskItem, index: number, result: PostponedTask, left: boolean) {
    startSaving(async () => {
      if (left) apply({ type: "restore", task, index });
      else apply({ type: "reschedule", id: task.id, dueDate: result.previousDueDate });
      await postponement.undo(task, result);
    });
  }

  const sheetFocus = useRef<string | null>(null);
  const picker = usePostponePicker({
    onSave: (picked, day) => {
      const task = view.find((item) => item.id === picked.id);
      if (!task) return;
      // The sheet gives focus back to the neighbor if this row is going to leave.
      if (!belongs({ ...task, dueDate: day })) picker.returnFocus.current = neighborElement(task.id);
      postponeRow(task, day, "pick");
    },
    onClosed: () => {
      const selector = sheetFocus.current;
      sheetFocus.current = null;
      const element = selector ? document.querySelector<HTMLElement>(selector) : null;
      if (element) element.focus();
      else afterSheetClosed();
    },
  });

  function postponeProps(task: TaskItem) {
    if (!postpone || task.doneAt) return undefined;
    return {
      onTomorrow: () => postponeRow(task, "tomorrow", "postpone"),
      onPick: (picked: { id: string; title: string }, trigger: HTMLElement) => {
        picker.openFor(picked, trigger, { minDay: limaToday(now), initialDay: tomorrowOf(now) });
      },
      tomorrowDisabled: task.dueDate === tomorrowOf(now),
    };
  }

  // ── Delete and undo ──
  function remove(task: TaskItem, index: number) {
    startSaving(async () => {
      apply({ type: "remove", id: task.id });
      const queued = await enqueue(`task-delete:${task.id}`, () => deleteTask({ id: task.id }));
      if (queued.kind === "skipped" || queued.superseded) return;
      const result: ActionResult<DeletedTask> =
        queued.kind === "done" ? queued.value : fail(TASKS_COPY.checkConnection);
      if (result.ok) {
        notifyDeleted(task, index);
        return;
      }
      notSaved(TASKS_COPY.notDeleted, failureReason(result));
    });
  }

  function notifyDeleted(task: TaskItem, index: number) {
    push({
      title: TASKS_COPY.deletedTitle,
      text: TASKS_COPY.deleted(task.title),
      action: { label: TASKS_COPY.undo, run: () => restore(task, index) },
    });
  }

  function restore(task: TaskItem, index: number) {
    startSaving(async () => {
      if (belongs(task)) apply({ type: "restore", task, index });
      // T3: a deleted occurrence may come back as a task of its own (said in the notice).
      const queued = await enqueue(`task-delete:${task.id}`, () =>
        restoreTaskWithSpawn({ id: task.id }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(TASKS_COPY.checkConnection);
      if (result.ok) announce(restoredNotice(task, result.data.detached));
      else notSaved(TASKS_COPY.notUndone, failureReason(result));
    });
  }

  // ── Classify (inbox) ──
  const [classifying, setClassifying] = useState<Opening | null>(null);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const classifyReturn = useRef<HTMLElement | null>(null);

  function openClassify(task: TaskItem, trigger: HTMLElement) {
    classifyReturn.current = trigger;
    setClassifying((previous) => ({ task, key: (previous?.key ?? 0) + 1 }));
    setClassifyOpen(true);
  }

  function saveClassify(task: TaskItem, value: PlacementValue, dueDate: string | null) {
    const moved = value !== placementValue(task);
    if (!moved && dueDate === task.dueDate) {
      setClassifyOpen(false);
      return;
    }
    const before: { placement: TaskPlacement; dueDate: string | null; dueTime: string | null } = {
      placement: toPlacement(placementValue(task), task),
      dueDate: task.dueDate,
      dueTime: task.dueTime,
    };
    // Taking the day away takes the time with it (the server too); "Deshacer" puts both back.
    // Known debt: like the placement it restores, this undo is unconditional (it does not compare
    // what the task has by now, as `restoreTaskDueDate` does), so an edit made after "Clasificar"
    // is overwritten. And a time added meanwhile to a task that had no day is lost: it can't
    // outlive its day (`tasks_due_time_check`).
    const patch = {
      ...placementPatch(targets, value, task),
      dueDate,
      ...(dueDate === null ? { dueTime: null } : {}),
    };
    const index = view.findIndex((item) => item.id === task.id);
    const leaves = !belongs({ ...task, ...patch });
    // The row's key leaves with it: the sheet hands focus to the neighbor instead.
    if (leaves) classifyReturn.current = neighborElement(task.id);
    setClassifyOpen(false);
    startSaving(async () => {
      apply(leaves ? { type: "remove", id: task.id } : { type: "update", id: task.id, patch });
      const queued = await enqueue(`task:${task.id}:placement`, () =>
        editTask({ id: task.id, placement: toPlacement(value, task), dueDate }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(TASKS_COPY.checkConnection);
      if (result.ok) {
        if (moved) {
          const where = placementName(targets, value) ?? TASKS_COPY.inboxTitle;
          push({
            title: TASKS_COPY.movedTitle,
            text: TASKS_COPY.movedTo(task.title, where),
            action: { label: TASKS_COPY.undo, run: () => unclassify(task, index, before) },
          });
        } else {
          announce(TASKS_COPY.dueSet(task.title));
        }
        return;
      }
      notSaved(TASKS_COPY.notSaved(TASK_FIELD_NAMES.placement), failureReason(result));
    });
  }

  function unclassify(
    task: TaskItem,
    index: number,
    before: { placement: TaskPlacement; dueDate: string | null; dueTime: string | null },
  ) {
    startSaving(async () => {
      apply({ type: "restore", task, index });
      const queued = await enqueue(`task:${task.id}:placement`, () =>
        editTask({
          id: task.id,
          placement: before.placement,
          dueDate: before.dueDate,
          dueTime: before.dueTime,
        }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(TASKS_COPY.checkConnection);
      if (result.ok) announce(TASKS_COPY.movedBack(task.title));
      else notSaved(TASKS_COPY.notUndone, failureReason(result));
    });
  }

  function deleteFromClassify(task: TaskItem) {
    const index = view.findIndex((item) => item.id === task.id);
    classifyReturn.current = neighborElement(task.id);
    setClassifyOpen(false);
    remove(task, index);
  }

  // ── Detail (desktop: side sheet; phone: the link goes to the task's page) ──
  const [detail, setDetail] = useState<Opening | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailReturn = useRef<HTMLElement | null>(null);

  function openDetail(task: TaskItem, event: React.MouseEvent<HTMLAnchorElement>) {
    // ⌘-click, a middle click or a new tab keep the link's own behavior (the task's page).
    if (!isDesktop || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    detailReturn.current = event.currentTarget;
    setDetail((previous) => ({ task, key: (previous?.key ?? 0) + 1 }));
    setDetailOpen(true);
  }

  function deletedFromDetail(task: TaskItem) {
    const index = tasks.findIndex((item) => item.id === task.id);
    if (index !== -1) detailReturn.current = neighborElement(task.id);
    setDetailOpen(false);
    notifyDeleted(task, index === -1 ? 0 : index);
  }

  const rows = (items: TaskItem[]) =>
    items.map((task) => {
      const postponeKeys = postponeProps(task);
      const row = (
        <>
          <TaskRow
            task={task}
            now={now}
            onToggle={toggle}
            onOpen={openDetail}
            onClassify={classify ? openClassify : undefined}
            onReopen={reopenable ? (item) => reopenFromRow(item, "reopen") : undefined}
            hidePlacement={hidePlacement}
            postpone={postponeKeys}
          />
          {rowAction?.(task)}
        </>
      );
      return postponeKeys ? (
        <SwipeRow
          key={task.id}
          taskId={task.id}
          swipe={swipe && !postponeKeys.tomorrowDisabled}
          onSwipe={() => postponeRow(task, "tomorrow", "postpone")}
        >
          {row}
        </SwipeRow>
      ) : (
        <li
          key={task.id}
          data-task-row={task.id}
          className="flex min-w-0 items-start gap-1 bg-surface pr-2"
        >
          {row}
        </li>
      );
    });

  return (
    <div className="flex flex-col gap-3" data-saving={saving ? "" : undefined}>
      {header?.(view.length)}
      {view.length === 0 ? (
        empty
      ) : groupOf ? (
        <div className="flex flex-col gap-5" aria-label={label} role="group">
          {groupRuns(view, groupOf).map(({ group, tasks: items }) => {
            const headingId = `${groupIds}-${group.key}`;
            return (
              // A div, not a named <section>: a group isn't a landmark (its list is named by the h3).
              <div key={group.key} className="flex flex-col gap-2">
                <h3 id={headingId} className="bo-text-body-strong" data-task-group={group.key}>
                  {group.label}
                </h3>
                <ul aria-labelledby={headingId} className="bo-list">
                  {rows(items)}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <ul aria-label={label} className="bo-list">
          {rows(view)}
        </ul>
      )}

      {classifying ? (
        <ClassifySheet
          key={classifying.key}
          open={classifyOpen}
          onOpenChange={setClassifyOpen}
          task={classifying.task}
          targets={targets}
          returnFocusRef={classifyReturn}
          onClosed={afterSheetClosed}
          onSave={saveClassify}
          onDelete={deleteFromClassify}
        />
      ) : null}

      {picker.sheet}

      {detail ? (
        <TaskDetailSheet
          key={detail.key}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          task={detail.task}
          returnFocusRef={detailReturn}
          onClosed={afterSheetClosed}
          onDeleted={deletedFromDetail}
        />
      ) : null}
    </div>
  );
}
