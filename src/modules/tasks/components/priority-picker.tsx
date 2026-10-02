"use client";

import { SegmentedControl, type SegmentOption } from "@/design-system";
import { PriorityLed } from "@/modules/projects/components/priority-led";
import { TASK_PRIORITIES, type TaskPriority } from "../task-constants";
import { TASK_PRIORITY_LABELS, TASKS_COPY } from "../tasks-copy";

const OPTIONS: SegmentOption<TaskPriority>[] = TASK_PRIORITIES.map((priority) => ({
  value: priority,
  label: (
    <>
      <PriorityLed priority={priority} />
      {TASK_PRIORITY_LABELS[priority]}
    </>
  ),
}));

type PriorityPickerProps = {
  value: TaskPriority;
  onValueChange: (value: TaskPriority) => void;
  /** Id of the visible label ("Prioridad"). */
  labelledBy: string;
};

/** Baja / Media / Alta with the same LEDs as projects: a radio group, 44 px keys. */
export function PriorityPicker({ value, onValueChange, labelledBy }: PriorityPickerProps) {
  return (
    <SegmentedControl
      mode="radio"
      touch
      options={OPTIONS}
      value={value}
      onValueChange={onValueChange}
      label={TASKS_COPY.priorityLabel}
      aria-labelledby={labelledBy}
    />
  );
}
