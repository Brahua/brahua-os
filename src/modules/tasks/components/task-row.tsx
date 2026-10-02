"use client";

import { FolderInput, Repeat, Undo2 } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { AreaTag, Icon, IconKey, Key, Led } from "@/design-system";
import { cn } from "@/lib/cn";
import { recurrenceSummary } from "../recurrence";
import { RECURRENCE_COPY } from "../recurrence-copy";
import { taskPath } from "../routes";
import { isUrgentDue, taskDueState } from "../task-due";
import type { TaskItem } from "../task-input";
import { doneLabel } from "../task-views";
import { TASKS_COPY } from "../tasks-copy";
import { VIEWS_COPY } from "../views-copy";

/**
 * Every focusable control of a row carries `data-task-focus="<control>:<id>"`, so focus can be
 * moved to a neighbor when a row leaves (completed, classified, deleted).
 */
export type TaskFocusControl = "check" | "title" | "classify" | "reopen";
export const taskFocusSelector = (id: string, control: TaskFocusControl) =>
  `[data-task-focus="${control}:${CSS.escape(id)}"]`;

type TaskRowProps = {
  task: TaskItem;
  now: Date;
  /** One tap completes it (or, done, reopens it). */
  onToggle: (task: TaskItem, done: boolean) => void;
  /**
   * Opening the title: on the desktop the list opens the detail in a sheet (the link's default
   * is the task's page, the phone's detail, and what ⌘-click or a new tab get).
   */
  onOpen: (task: TaskItem, event: React.MouseEvent<HTMLAnchorElement>) => void;
  /** The inbox's quick action ("Clasificar"): area or project and a date. Absent elsewhere. */
  onClassify?: (task: TaskItem, trigger: HTMLElement) => void;
  /** "Hechas": a visible "Deshacer" that makes the task pending again. Absent elsewhere. */
  onReopen?: (task: TaskItem) => void;
};

/**
 * One task (SPEC-tasks "Cada fila"): checkbox (one tap completes), the title (opens the detail)
 * and compact metadata: area or project, the due label ("Vence hoy", "Retrasada hace 2 días")
 * and "Alta" with its LED. The `<li>` is the caller's.
 */
export function TaskRow({ task, now, onToggle, onOpen, onClassify, onReopen }: TaskRowProps) {
  const metaId = useId();
  const due = taskDueState(task.dueDate, task.doneAt, now);
  const done = task.doneAt !== null;
  const where = task.project ? task.project.name : null;
  const areaLabel = task.area ? (where ? `${task.area.name} · ${where}` : task.area.name) : null;
  // What the title's description says, in words. The visible metadata is aria-hidden: its flex
  // items would be read run together ("Vence hoyPrioridad alta"). T3 and T4 add their parts here.
  const doneText = task.doneAt ? doneLabel(task.doneAt, now) : null;
  const description = [
    doneText,
    areaLabel,
    due?.label,
    task.priority === "high" ? TASKS_COPY.highPriority : null,
    task.recurrence ? RECURRENCE_COPY.rowDescription(recurrenceSummary(task.recurrence)) : null,
  ]
    .filter(Boolean)
    .join(", ");
  const hasMeta = description !== "";

  return (
    <>
      {/* A label: the whole 44 px square toggles the 20 px checkbox. */}
      <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          className="bo-milestone-check"
          checked={done}
          aria-label={TASKS_COPY.complete(task.title)}
          data-task-focus={`check:${task.id}`}
          onChange={(event) => onToggle(task, event.target.checked)}
        />
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-2.5">
        <Link
          href={taskPath(task.id)}
          prefetch={false}
          className={cn("bo-task-title bo-text-body", done && "text-text-secondary line-through")}
          aria-describedby={hasMeta ? metaId : undefined}
          data-task-focus={`title:${task.id}`}
          onClick={(event) => onOpen(task, event)}
        >
          {task.title}
        </Link>
        {hasMeta ? (
          <span id={metaId} hidden>
            {description}
          </span>
        ) : null}
        {hasMeta ? (
          <p
            aria-hidden
            className="bo-text-body-sm flex flex-wrap items-center gap-x-3 gap-y-1"
          >
            {doneText ? <span className="text-text-secondary">{doneText}</span> : null}
            {task.area ? (
              <AreaTag
                area={task.area.color}
                icon={task.area.icon}
                label={areaLabel ?? undefined}
                className="min-w-0 max-w-full truncate"
              />
            ) : null}
            {due ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5",
                  isUrgentDue(due) ? "text-signal-text" : "text-text-secondary",
                )}
                data-task-due={due.kind}
              >
                {isUrgentDue(due) ? <Led signal on size="sm" /> : null}
                {due.label}
              </span>
            ) : null}
            {task.priority === "high" ? (
              <span className="inline-flex items-center gap-1.5 text-text-secondary">
                <Led signal size="sm" />
                {TASKS_COPY.highPriorityShort}
              </span>
            ) : null}
            {task.recurrence ? (
              <span
                className="inline-flex items-center text-text-secondary"
                title={recurrenceSummary(task.recurrence)}
                data-task-recurrence=""
              >
                <Icon icon={Repeat} size="sm" />
              </span>
            ) : null}

            {/* ── T4 slot (Etiquetas): the tags, from task.tags. ── */}
          </p>
        ) : null}
      </div>
      {onClassify ? (
        <IconKey
          icon={FolderInput}
          label={TASKS_COPY.classify(task.title)}
          variant="ghost"
          placement="top"
          tooltip={false}
          className="mt-0 shrink-0 self-center"
          aria-haspopup="dialog"
          data-task-focus={`classify:${task.id}`}
          onClick={(event) => onClassify(task, event.currentTarget)}
        />
      ) : null}
      {onReopen ? (
        <Key
          variant="ghost"
          size="sm"
          icon={Undo2}
          className="shrink-0 self-center"
          aria-label={VIEWS_COPY.reopenName(task.title)}
          data-task-focus={`reopen:${task.id}`}
          onClick={() => onReopen(task)}
        >
          {VIEWS_COPY.reopen}
        </Key>
      ) : null}
    </>
  );
}
