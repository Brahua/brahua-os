"use client";

import { ChevronDown } from "lucide-react";
import { startTransition, useEffect, useId, useOptimistic, useState } from "react";
import { Icon } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { listTaskMilestones, setTaskMilestone } from "../../detail-actions";
import type { TaskMilestoneOption } from "../../milestone-data";
import type { TaskItem } from "../../task-input";
import { TASKS_COPY } from "../../tasks-copy";
import { VIEWS_COPY } from "../../views-copy";
import { failureReason } from "../tasks-screen";
import { useTaskDetail } from "./task-detail-context";

/** The project's milestones; `undefined` while loading, `false` when loading failed. */
type Options = { projectId: string; milestones: TaskMilestoneOption[] | false } | undefined;

/**
 * "Hito" (SPEC-tasks): only when the task has a project. A native select with "Sin hito" and the
 * project's live milestones in their order (asked when the project is known: the lists don't
 * carry them). Saved when picked; the server checks the milestone is of the task's project.
 */
export function TaskMilestoneField() {
  const { task } = useTaskDetail();
  if (task.projectId === null) return null;
  // A new project (the task was moved): a fresh field, with that project's milestones.
  return <MilestoneSelect key={task.projectId} projectId={task.projectId} />;
}

function MilestoneSelect({ projectId }: { projectId: string }) {
  const { task, enqueue, announce, reportError, adopt } = useTaskDetail();
  const [options, setOptions] = useState<Options>(undefined);
  const [value, setOptimisticValue] = useOptimistic(task.milestoneId ?? "");
  const id = useId();

  useEffect(() => {
    let current = true;
    const failed = () => {
      if (current) setOptions({ projectId, milestones: false });
    };
    listTaskMilestones({ projectId }).then((result) => {
      if (!current) return;
      if (result.ok) setOptions({ projectId, milestones: result.data });
      else failed();
    }, failed);
    return () => {
      current = false;
    };
  }, [projectId]);

  const milestones = options?.milestones;
  const help =
    options === undefined
      ? VIEWS_COPY.milestoneLoading
      : milestones === false
        ? VIEWS_COPY.milestoneLoadFailed
        : milestones?.length === 0
          ? VIEWS_COPY.milestoneNone
          : VIEWS_COPY.milestoneHelp;
  // The current milestone stays listed while the options load (or if they failed).
  const listed = Array.isArray(milestones) ? milestones : [];

  function pick(next: string) {
    if (next === (task.milestoneId ?? "")) return;
    const taskId = task.id;
    startTransition(async () => {
      setOptimisticValue(next);
      const queued = await enqueue(`task-milestone:${taskId}`, () =>
        setTaskMilestone({ id: taskId, milestoneId: next === "" ? null : next }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        adopt(queued.value.data);
        announce(next === "" ? VIEWS_COPY.milestoneCleared : VIEWS_COPY.milestoneSaved);
        return;
      }
      const reason =
        queued.kind === "threw"
          ? TASKS_COPY.checkConnection
          : failureReason(queued.value as Extract<ActionResult<TaskItem>, { ok: false }>);
      reportError(`${VIEWS_COPY.milestoneNotSaved} ${reason}`);
    });
  }

  return (
    <div className="bo-field" data-task-milestone="">
      <label className="bo-field__label" htmlFor={id}>
        {VIEWS_COPY.milestoneLabel}
      </label>
      <div className="bo-select">
        <select
          id={id}
          className="bo-field__control"
          value={value}
          aria-describedby={`${id}-help`}
          onChange={(event) => pick(event.target.value)}
        >
          <option value="">{VIEWS_COPY.noMilestone}</option>
          {listed.map((milestone) => (
            <option key={milestone.id} value={milestone.id}>
              {milestone.done ? VIEWS_COPY.milestoneDone(milestone.title) : milestone.title}
            </option>
          ))}
          {value !== "" && !listed.some((milestone) => milestone.id === value) ? (
            // Loading (or failed): the current one, so the select never shows a wrong value.
            <option value={value}>
              {options === undefined
                ? VIEWS_COPY.milestoneLoadingOption
                : VIEWS_COPY.milestoneCurrentOption}
            </option>
          ) : null}
        </select>
        <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
      </div>
      <span id={`${id}-help`} className="bo-field__help">
        {help}
      </span>
    </div>
  );
}
