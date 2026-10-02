"use client";

import { useId } from "react";
import { SectionLabel } from "@/design-system";
import { TASKS_COPY } from "../../tasks-copy";
import { PriorityPicker } from "../priority-picker";
import { useSaveTaskField, useTaskDetail } from "./task-detail-context";

/** Prioridad: Baja / Media / Alta, saved when picked (like the project's). */
export function TaskPrioritySection() {
  const { task, host } = useTaskDetail();
  const save = useSaveTaskField();
  const ids = useId();
  const headingId = `${ids}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionLabel
        id={headingId}
        as={host === "sheet" ? "h3" : "h2"}
        title={TASKS_COPY.priorityLabel}
      />
      <PriorityPicker
        value={task.priority}
        labelledBy={headingId}
        onValueChange={(priority) => {
          if (priority !== task.priority) save("priority", { priority }, { priority });
        }}
      />
    </section>
  );
}
