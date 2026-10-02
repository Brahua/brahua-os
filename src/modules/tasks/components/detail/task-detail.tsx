"use client";

import { formatOwnerDay } from "@/lib/time";
import { TASKS_COPY } from "../../tasks-copy";
import { useTaskDetail } from "./task-detail-context";
import { TaskDeleteSection } from "./task-delete-section";
import { TaskNextActionSection } from "./task-next-action-section";
import { TaskNotesSection } from "./task-notes-section";
import { TaskPlanSection } from "./task-plan-section";
import { TaskPrioritySection } from "./task-priority-section";
import { TaskRecurrenceSection } from "./task-recurrence-section";
import { TaskTagsSection } from "./task-tags-section";
import { TaskTitleSection } from "./task-title-section";

/**
 * The sections of a task's detail, the same in the desktop sheet and the phone page (the host
 * draws the heading: the sheet's title or the page's h1). Each section is its own file and reads
 * `useTaskDetail()`; the task's own fields save with `useSaveTaskField()`.
 *
 * Extension points (T2–T5 are built in parallel: each one adds its own file and its own line in
 * a marked slot, nothing else; its actions and copy go in its own files too, never appended to
 * actions.ts or tasks-copy.ts, so the three branches don't touch the same lines). Section
 * headings: h3 when `host` is "sheet", h2 on the page.
 * - T2 (Notas): `task-notes-section.tsx` in the "Notas" slot; the milestone picker in the slot of
 *   `TaskPlanSection`.
 * - T3 (Recurrencia): `task-recurrence-section.tsx` in its slot.
 * - T4 (Etiquetas): `task-tags-section.tsx` in its slot.
 * - T5 (Próxima acción): `task-next-action-section.tsx` in its slot.
 */
export function TaskDetail() {
  const { task } = useTaskDetail();
  return (
    <div className="flex flex-col gap-8" data-task-detail={task.id}>
      {task.doneAt ? (
        <p className="bo-text-body-sm text-text-secondary">
          {TASKS_COPY.doneOn(formatOwnerDay(task.doneAt))}
        </p>
      ) : null}
      <TaskTitleSection />
      <TaskPlanSection />
      <TaskNextActionSection />

      <TaskPrioritySection />

      <TaskTagsSection />

      <TaskRecurrenceSection />

      <TaskNotesSection />

      <TaskDeleteSection />
    </div>
  );
}
