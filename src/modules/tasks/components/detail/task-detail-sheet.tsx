"use client";

import { Sheet } from "@/design-system";
import type { TaskItem } from "../../task-input";
import { TaskDetail } from "./task-detail";
import {
  TaskDetailProvider,
  TaskDetailSheetMessages,
  useTaskDetail,
} from "./task-detail-context";

export type TaskDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskItem;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClosed?: () => void;
  onDeleted: (task: TaskItem) => void;
};

/**
 * A task's detail on the desktop (SPEC-tasks "Detalle": a side sheet over the list). The phone
 * gets the same sections on the task's page (/tasks/<id>).
 */
export function TaskDetailSheet({ task, onDeleted, ...sheet }: TaskDetailSheetProps) {
  return (
    <TaskDetailProvider task={task} host="sheet" onDeleted={onDeleted}>
      <DetailSheetFrame {...sheet} />
    </TaskDetailProvider>
  );
}

function DetailSheetFrame({
  open,
  onOpenChange,
  returnFocusRef,
  onClosed,
}: Omit<TaskDetailSheetProps, "task" | "onDeleted">) {
  // The title follows the edits (optimistic), like the page's h1.
  const { task } = useTaskDetail();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant="side"
      title={task.title}
      returnFocusRef={returnFocusRef}
      focusTitleOnOpen
      onClosed={onClosed}
    >
      <div className="flex flex-col gap-6">
        <TaskDetailSheetMessages />
        <TaskDetail />
      </div>
    </Sheet>
  );
}
