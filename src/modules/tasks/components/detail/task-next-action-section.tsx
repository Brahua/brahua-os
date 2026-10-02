"use client";

import { startTransition, useId, useOptimistic } from "react";
import { SectionLabel, Switch } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { isClosed } from "@/modules/projects/project-close";
import { setNextAction } from "../../project-task-actions";
import { PROJECT_TASKS_COPY } from "../../project-tasks-copy";
import type { TaskItem } from "../../task-input";
import { TASKS_COPY } from "../../tasks-copy";
import { failureReason } from "../tasks-screen";
import { useTaskDetail } from "./task-detail-context";

/**
 * "Próxima acción" (T5): only for a task of a project. A switch marks it as the project's next
 * action (one per project: marking it takes the mark from the previous one) or unmarks it.
 * A done task, or one of a closed project, can't be marked: the section says why instead.
 */
export function TaskNextActionSection() {
  const { task, host, enqueue, adopt, announce, reportError } = useTaskDetail();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const helpId = `${ids}-help`;
  const [checked, setChecked] = useOptimistic(task.isNextAction);
  if (!task.project) return null;
  const project = task.project;

  const reason =
    task.doneAt !== null
      ? PROJECT_TASKS_COPY.detailDone
      : isClosed(project.status)
        ? PROJECT_TASKS_COPY.detailClosed
        : null;

  function toggle(next: boolean) {
    const id = task.id;
    startTransition(async () => {
      setChecked(next);
      const queued = await enqueue(`task-next:${id}`, () => setNextAction({ id, next }));
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        adopt(queued.value.data);
        announce(
          next ? PROJECT_TASKS_COPY.marked(task.title) : PROJECT_TASKS_COPY.unmarked(task.title),
        );
        return;
      }
      const why =
        queued.kind === "threw"
          ? TASKS_COPY.checkConnection
          : failureReason(queued.value as Extract<ActionResult<TaskItem>, { ok: false }>);
      reportError(`${PROJECT_TASKS_COPY.notMarked} ${why}`);
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" data-task-next-action="">
      <SectionLabel
        id={headingId}
        as={host === "sheet" ? "h3" : "h2"}
        title={PROJECT_TASKS_COPY.detailSection}
      />
      {reason && !checked ? (
        <p className="bo-text-body-sm text-text-secondary">{reason}</p>
      ) : (
        <div className="flex items-start gap-3">
          <Switch
            id={`${ids}-switch`}
            checked={checked}
            aria-labelledby={`${ids}-label`}
            aria-describedby={helpId}
            onCheckedChange={toggle}
            className="mt-1 shrink-0"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <label
              id={`${ids}-label`}
              htmlFor={`${ids}-switch`}
              className="bo-text-body cursor-pointer break-words"
            >
              {PROJECT_TASKS_COPY.detailSwitch(project.name)}
            </label>
            <span id={helpId} className="bo-text-body-sm text-text-secondary">
              {PROJECT_TASKS_COPY.detailHelp}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
