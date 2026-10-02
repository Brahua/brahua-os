"use client";

import { ChevronDown, Flag } from "lucide-react";
import { useId, useOptimistic, useState, useTransition } from "react";
import { Icon, IconKey, SectionLabel } from "@/design-system";
import { cn } from "@/lib/cn";
import {
  applyNextActionChange,
  groupsByMilestone,
  milestoneGroupOf,
  sortByMilestone,
  type MilestoneRef,
  type NextActionChange,
} from "../../project-task-groups";
import { setNextAction, undoCompleteNextAction } from "../../project-task-actions";
import { PROJECT_TASKS_COPY } from "../../project-tasks-copy";
import type { TaskItem, TaskTargets } from "../../task-input";
import { TASKS_COPY } from "../../tasks-copy";
import { TaskList } from "../task-list";
import { failureReason, TasksScreenWithin, useTasksScreen } from "../tasks-screen";
import { ProjectTaskAdd } from "./project-task-add";

type ProjectTasksSectionProps = {
  project: { id: string; name: string };
  /** Not done nor canceled: tasks can be added and a next action marked. */
  open: boolean;
  milestones: MilestoneRef[];
  /** Pending, in the order of "Todas" (the section sorts them by milestone). */
  pending: TaskItem[];
  /** Done in the last 30 days, the most recent first. */
  done: TaskItem[];
  now: Date;
  targets: TaskTargets;
};

/**
 * "Tareas" on a project's page (T5, SPEC-tasks "En proyectos"): the pending tasks grouped by
 * milestone ("Sin hito" last), the next action (one per project: a flag on each row), adding
 * inline (Enter adds another) and the recently done ones folded. Rows behave like every list of
 * tasks (one tap completes with "Deshacer", the title opens the detail). It lives inside the
 * page's queue, notices and announcer (`TasksScreenWithin`), so the page keeps one viewport.
 */
export function ProjectTasksSection({ now, targets, ...props }: ProjectTasksSectionProps) {
  return (
    <TasksScreenWithin now={now} targets={targets}>
      <Section {...props} />
    </TasksScreenWithin>
  );
}

function Section({
  project,
  open,
  milestones,
  pending,
  done,
}: Omit<ProjectTasksSectionProps, "now" | "targets">) {
  const ids = useId();
  const headingId = `${ids}-heading`;
  const { enqueue, toaster, announce } = useTasksScreen();
  const [saving, startSaving] = useTransition();
  // The mark shows at once; the server's answer (the page revalidates) replaces it.
  const [view, applyMark] = useOptimistic(pending, (tasks: TaskItem[], change: NextActionChange) =>
    applyNextActionChange(tasks, change),
  );
  const sorted = sortByMilestone(view, milestones);
  const grouped = groupsByMilestone(sorted, milestones);
  const next = view.find((task) => task.isNextAction) ?? null;

  function mark(task: TaskItem, value: boolean) {
    startSaving(async () => {
      applyMark({ id: task.id, next: value });
      const queued = await enqueue(`task-next:${task.id}`, () =>
        setNextAction({ id: task.id, next: value }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        announce(value ? PROJECT_TASKS_COPY.marked(task.title) : PROJECT_TASKS_COPY.unmarked(task.title));
        return;
      }
      const reason =
        queued.kind === "threw"
          ? TASKS_COPY.checkConnection
          : failureReason(queued.value as Extract<typeof queued.value, { ok: false }>);
      toaster.push({
        title: TASKS_COPY.notSavedTitle,
        text: `${PROJECT_TASKS_COPY.notMarked} ${reason}`,
        tone: "error",
      });
    });
  }

  /**
   * "Deshacer" of completing the next action: one call reopens it and marks it again (unless
   * another task got the mark meanwhile), in one transaction, so the page refreshes once. Other
   * tasks use the plain reopen.
   */
  function undoCompletion(task: TaskItem) {
    if (!task.isNextAction) return null;
    return async () => {
      const result = await undoCompleteNextAction({ id: task.id });
      if (result.ok && result.data.warning) {
        // Pending again, but it couldn't be the next action again (e.g. the project closed).
        toaster.push({
          title: TASKS_COPY.notSavedTitle,
          text: `«${task.title}»: ${result.data.warning}`,
          tone: "error",
        });
      }
      return result;
    };
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
      data-project-tasks={project.id}
      data-saving={saving || undefined}
    >
      <TaskList
        tasks={sorted}
        label={PROJECT_TASKS_COPY.listLabel}
        belongs={(task) => task.doneAt === null}
        fallbackFocusId={headingId}
        hidePlacement
        groupOf={grouped ? milestoneGroupOf(milestones) : undefined}
        undoCompletion={undoCompletion}
        header={(count) => (
          <>
            <SectionLabel
              id={headingId}
              as="h2"
              tabIndex={-1}
              className="outline-none"
              title={PROJECT_TASKS_COPY.section}
              count={count > 0 ? count : undefined}
              aria-label={PROJECT_TASKS_COPY.sectionName(count)}
            />
            {open && count > 0 ? (
              <p className="bo-text-body-sm text-text-secondary" data-next-action-line="">
                {next ? (
                  <>
                    <span className="bo-text-label">{PROJECT_TASKS_COPY.nextLabel}:</span>{" "}
                    <span className="text-text">{next.title}</span>
                  </>
                ) : (
                  PROJECT_TASKS_COPY.nextNone
                )}
              </p>
            ) : null}
          </>
        )}
        empty={
          <p className="bo-text-body-sm text-text-secondary">
            {open ? PROJECT_TASKS_COPY.emptyOpen : PROJECT_TASKS_COPY.empty}
          </p>
        }
        rowAction={
          open
            ? (task) => (
                <IconKey
                  icon={Flag}
                  label={PROJECT_TASKS_COPY.markNext(task.title)}
                  variant="ghost"
                  tooltip={false}
                  toggle
                  pressed={task.isNextAction}
                  onPressedChange={(value) => mark(task, value)}
                  className="mt-0 shrink-0 self-center"
                  data-task-focus={`next:${task.id}`}
                />
              )
            : undefined
        }
      />
      {open ? (
        <ProjectTaskAdd projectId={project.id} milestones={milestones} />
      ) : (
        <p className="bo-text-body-sm text-text-secondary">{PROJECT_TASKS_COPY.closed}</p>
      )}
      <DoneTasks tasks={done} />
    </section>
  );
}

/** The recently done tasks, folded (the same disclosure pattern as "Historial"). */
function DoneTasks({ tasks }: { tasks: TaskItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const ids = useId();
  if (tasks.length === 0) return null;
  const panelId = `${ids}-panel`;
  const toggleId = `${ids}-toggle`;
  const label = PROJECT_TASKS_COPY.doneName(tasks.length);
  return (
    <div className="flex flex-col gap-3" data-project-done-tasks="">
      <h3 aria-label={label} className="flex">
        <button
          id={toggleId}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={label}
          onClick={() => setExpanded((value) => !value)}
          className="bo-section-label min-h-11 flex-1 cursor-pointer rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className="flex items-center gap-3">
            <span className="bo-section-label__title">{PROJECT_TASKS_COPY.doneTitle}</span>
            <span className="bo-section-label__count">{tasks.length}</span>
          </span>
          <Icon icon={ChevronDown} size="sm" className={cn(expanded && "rotate-180")} />
        </button>
      </h3>
      <div id={panelId} hidden={!expanded}>
        <TaskList
          tasks={tasks}
          label={PROJECT_TASKS_COPY.doneListLabel}
          belongs={(task) => task.doneAt !== null}
          fallbackFocusId={toggleId}
          hidePlacement
          reopenable
          empty={<p className="bo-text-body-sm text-text-secondary">{PROJECT_TASKS_COPY.doneEmpty}</p>}
        />
      </div>
    </div>
  );
}
