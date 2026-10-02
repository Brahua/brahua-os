"use client";

import { useId } from "react";
import { SectionLabel } from "@/design-system";
import { placementPatch, placementValue, toPlacement } from "../../placement";
import { taskDueState } from "../../task-due";
import { TASKS_COPY } from "../../tasks-copy";
import { DateField } from "../date-field";
import { PlacementSelect } from "../placement-select";
import { useSaveTaskField, useTaskDetail } from "./task-detail-context";
import { TaskMilestoneField } from "./task-milestone-field";

/** A full YYYY-MM-DD from the date input (a half-typed date is ""). */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Dónde y cuándo": area or project (saved when picked) and the due date (saved when a whole
 * date is picked or it is cleared), with its label ("Vence hoy", "Retrasada hace 2 días").
 */
export function TaskPlanSection() {
  const { task, targets, now, host } = useTaskDetail();
  const save = useSaveTaskField();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const due = taskDueState(task.dueDate, task.doneAt, now);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* h3 in the sheet (its title is the h2), h2 on the page (under the h1). */}
      <SectionLabel
        id={headingId}
        as={host === "sheet" ? "h3" : "h2"}
        title={TASKS_COPY.planTitle}
      />
      <PlacementSelect
        id={`${ids}-placement`}
        targets={targets}
        current={task}
        value={placementValue(task)}
        onValueChange={(value) =>
          save(
            "placement",
            placementPatch(targets, value, task),
            { placement: toPlacement(value, task) },
            { announceSaved: true },
          )
        }
      />
      <TaskMilestoneField />
      <DateField
        id={`${ids}-due`}
        label={TASKS_COPY.dueLabel}
        value={task.dueDate ?? ""}
        help={due?.label ?? TASKS_COPY.dueHelp}
        onChange={(event) => {
          const value = event.target.value;
          if (value !== "" && !DAY.test(value)) return;
          const dueDate = value === "" ? null : value;
          if (dueDate === task.dueDate) return;
          save("dueDate", { dueDate }, { dueDate }, { announceSaved: true });
        }}
      />
    </section>
  );
}
