"use client";

import { Flag } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { AreaTag, Icon, Led } from "@/design-system";
import { PROJECT_TASKS_COPY } from "../project-tasks-copy";
import { taskPath } from "../routes";
import { TASKS_COPY } from "../tasks-copy";
import type { TaskTodayItem } from "../today-summary";

/** `data-task-focus` of a today row's checkbox: where focus goes when a neighbor row leaves. */
export const taskTodayCheckSelector = (id: string) =>
  `[data-task-focus="check:${CSS.escape(id)}"]`;

type TaskTodayRowProps = {
  task: TaskTodayItem;
  /** One tap completes it (the caller removes the row and saves). */
  onComplete: (task: TaskTodayItem) => void;
  /**
   * A save of this task is in flight (an undo putting it back): the checkbox stays focusable and
   * says so with `aria-disabled`, and a tap does nothing (never `disabled` on a focused control).
   */
  busy?: boolean;
};

/**
 * A task of `getTasksTodaySummary` (T6) on another module's screen (`today`'s "Tareas", D2), as
 * the task lists draw it: the checkbox ("Hecha: X"), the title linking to its page
 * (`taskPath(id)`) and compact metadata: area and project, "Retrasada hace N días" / "Vence hoy"
 * (the lists' color, never red), "Alta" and the next-action mark. The visible metadata is
 * aria-hidden (its flex items would be read run together); the title is described in words. The
 * `<li>` is the caller's.
 */
export function TaskTodayRow({ task, onComplete, busy = false }: TaskTodayRowProps) {
  const metaId = useId();
  const areaLabel = task.area
    ? task.project
      ? `${task.area.name} · ${task.project.name}`
      : task.area.name
    : null;
  const description = [
    areaLabel,
    task.due.label,
    task.priority === "high" ? TASKS_COPY.highPriority : null,
    task.isNextAction ? PROJECT_TASKS_COPY.nextLabel : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      {/* A label: the whole 44 px square toggles the 20 px checkbox. */}
      <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          className="bo-milestone-check"
          checked={false}
          aria-label={TASKS_COPY.complete(task.title)}
          aria-disabled={busy || undefined}
          data-task-focus={`check:${task.id}`}
          onChange={() => {
            if (!busy) onComplete(task);
          }}
        />
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-2.5">
        <Link
          href={taskPath(task.id)}
          prefetch={false}
          className="bo-task-title bo-text-body"
          aria-describedby={metaId}
          data-task-focus={`title:${task.id}`}
        >
          {task.title}
        </Link>
        <span id={metaId} hidden>
          {description}
        </span>
        <p aria-hidden className="bo-text-body-sm flex flex-wrap items-center gap-x-3 gap-y-1">
          {task.area ? (
            <AreaTag
              area={task.area.color}
              icon={task.area.icon}
              label={areaLabel ?? undefined}
              className="min-w-0 max-w-full truncate"
            />
          ) : null}
          {/* Overdue and due today are both `isUrgentDue`: the lists' orange with a LED. */}
          <span
            className="inline-flex items-center gap-1.5 text-signal-text"
            data-task-due={task.due.kind}
          >
            <Led signal on size="sm" />
            {task.due.label}
          </span>
          {task.priority === "high" ? (
            <span className="inline-flex items-center gap-1.5 text-text-secondary">
              <Led signal size="sm" />
              {TASKS_COPY.highPriorityShort}
            </span>
          ) : null}
          {task.isNextAction ? (
            <span
              className="inline-flex items-center gap-1.5 text-text-secondary"
              data-task-next-action=""
            >
              <Icon icon={Flag} size="sm" />
              {PROJECT_TASKS_COPY.nextLabel}
            </span>
          ) : null}
        </p>
      </div>
    </>
  );
}
