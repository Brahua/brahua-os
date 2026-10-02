"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { fail, type ActionResult } from "@/lib/action-result";
import { useIsDesktop } from "@/lib/use-is-desktop";
import {
  completeTask,
  deleteTask,
  editTask,
  reopenTask,
  restoreTask,
} from "../actions";
import {
  placementName,
  placementPatch,
  placementValue,
  toPlacement,
  type PlacementValue,
} from "../placement";
import type { DeletedTask, TaskItem, TaskPlacement } from "../task-input";
import { applyTaskListChange, neighborOf } from "../task-list-optimistic";
import { groupRuns, type TaskGroup } from "../task-views";
import { TASK_FIELD_NAMES, TASKS_COPY } from "../tasks-copy";
import { VIEWS_COPY } from "../views-copy";
import { TaskRow, taskFocusSelector } from "./task-row";
import { failureReason, useTasksScreen } from "./tasks-screen";

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
}: TaskListProps) {
  const groupIds = useId();
  const { now, targets, enqueue, toaster, announce } = useTasksScreen();
  const { push } = toaster;
  const isDesktop = useIsDesktop();
  const [view, apply] = useOptimistic(tasks, applyTaskListChange);
  const [saving, startSaving] = useTransition();

  // ── Focus when a row leaves ──
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const selector = pendingFocus.current;
    if (!selector) return;
    pendingFocus.current = null;
    const element =
      document.querySelector<HTMLElement>(selector) ?? document.getElementById(fallbackFocusId);
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

  /** Moves focus to the neighbor after the commit, if focus was in the leaving row (or nowhere). */
  function focusAfterLeaving(id: string) {
    const active = document.activeElement;
    const inRow = active?.closest(`[data-task-row="${CSS.escape(id)}"]`);
    if (!inRow && active && active !== document.body) return;
    const neighbor = neighborOf(view, id);
    pendingFocus.current = neighbor
      ? taskFocusSelector(neighbor.id, "check")
      : `#${CSS.escape(fallbackFocusId)}`;
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
  function toggle(task: TaskItem, done: boolean) {
    if (!done) {
      reopenFromRow(task);
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
      const queued = await enqueue(`task-done:${task.id}`, () => completeTask({ id: task.id }));
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(TASKS_COPY.checkConnection);
      if (result.ok) {
        push({
          title: TASKS_COPY.completedTitle,
          text: TASKS_COPY.completed(task.title),
          action: { label: TASKS_COPY.undo, run: () => reopen(task, index) },
        });
        return;
      }
      notSaved(TASKS_COPY.notCompleted, failureReason(result));
    });
  }

  /**
   * Unchecking a done row (or its "Deshacer" in "Hechas"): pending again. Where pending tasks
   * don't belong ("Hechas"), the row leaves, with a notice whose "Deshacer" completes it again.
   */
  function reopenFromRow(task: TaskItem) {
    const index = view.findIndex((item) => item.id === task.id);
    const reopened: TaskItem = { ...task, doneAt: null };
    if (belongs(reopened)) {
      reopen(task, index);
      return;
    }
    focusAfterLeaving(task.id);
    startSaving(async () => {
      apply({ type: "remove", id: task.id });
      const queued = await enqueue(`task-done:${task.id}`, () => reopenTask({ id: task.id }));
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(TASKS_COPY.checkConnection);
      if (result.ok) {
        push({
          title: VIEWS_COPY.reopenedTitle,
          text: TASKS_COPY.reopened(task.title),
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
      const queued = await enqueue(`task-done:${task.id}`, () => completeTask({ id: task.id }));
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(TASKS_COPY.checkConnection);
      if (result.ok) announce(VIEWS_COPY.completedAgain(task.title));
      else notSaved(TASKS_COPY.notUndone, failureReason(result));
    });
  }

  function reopen(task: TaskItem, index: number) {
    startSaving(async () => {
      const reopened: TaskItem = { ...task, doneAt: null };
      // "Deshacer" of a completion: back in its place, unless pending tasks don't belong here.
      if (belongs(reopened)) apply({ type: "restore", task: reopened, index });
      else apply({ type: "remove", id: task.id });
      const queued = await enqueue(`task-done:${task.id}`, () => reopenTask({ id: task.id }));
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(TASKS_COPY.checkConnection);
      if (result.ok) announce(TASKS_COPY.reopened(task.title));
      else notSaved(TASKS_COPY.notUndone, failureReason(result));
    });
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
      const queued = await enqueue(`task-delete:${task.id}`, () => restoreTask({ id: task.id }));
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(TASKS_COPY.checkConnection);
      if (result.ok) announce(TASKS_COPY.restored(task.title));
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
    const before: { placement: TaskPlacement; dueDate: string | null } = {
      placement: toPlacement(placementValue(task), task),
      dueDate: task.dueDate,
    };
    const patch = { ...placementPatch(targets, value, task), dueDate };
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
    before: { placement: TaskPlacement; dueDate: string | null },
  ) {
    startSaving(async () => {
      apply({ type: "restore", task, index });
      const queued = await enqueue(`task:${task.id}:placement`, () =>
        editTask({ id: task.id, placement: before.placement, dueDate: before.dueDate }),
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
    items.map((task) => (
      <li
        key={task.id}
        data-task-row={task.id}
        className="flex min-w-0 items-start gap-1 bg-surface pr-2"
      >
        <TaskRow
          task={task}
          now={now}
          onToggle={toggle}
          onOpen={openDetail}
          onClassify={classify ? openClassify : undefined}
          onReopen={reopenable ? reopenFromRow : undefined}
        />
      </li>
    ));

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
              <section key={group.key} aria-labelledby={headingId} className="flex flex-col gap-2">
                <h3 id={headingId} className="bo-text-body-strong" data-task-group={group.key}>
                  {group.label}
                </h3>
                <ul aria-labelledby={headingId} className="bo-list">
                  {rows(items)}
                </ul>
              </section>
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
