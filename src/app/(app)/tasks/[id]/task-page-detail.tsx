"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback } from "react";
import { TaskDetail } from "@/modules/tasks/components/detail/task-detail";
import {
  TaskDetailProvider,
  useTaskDetail,
} from "@/modules/tasks/components/detail/task-detail-context";
import { TaskNotesSeed } from "@/modules/tasks/components/detail/task-notes-section";
import { DELETED_PARAM, TASKS_PATH } from "@/modules/tasks/routes";
import type { TaskItem } from "@/modules/tasks/task-input";

type TaskPageDetailProps = {
  task: TaskItem;
  headingId: string;
  /** The task's notes, and the same rendered on the server (T2). */
  notes: string | null;
  renderedNotes: React.ReactNode;
};

/**
 * The detail on the task's page (the phone's detail, SPEC-tasks). Deleting goes back to the list,
 * which offers "Deshacer" (`?deleted=<id>`); `replace`, so going back never lands on a 404.
 */
export function TaskPageDetail({ task, headingId, notes, renderedNotes }: TaskPageDetailProps) {
  const router = useRouter();
  const onDeleted = useCallback(
    (deleted: TaskItem) => {
      startTransition(() => router.replace(`${TASKS_PATH}?${DELETED_PARAM}=${deleted.id}`));
    },
    [router],
  );
  return (
    <TaskDetailProvider task={task} host="page" onDeleted={onDeleted}>
      <TaskNotesSeed notes={notes} rendered={renderedNotes}>
        <PageHeading id={headingId} />
        <TaskDetail />
      </TaskNotesSeed>
    </TaskDetailProvider>
  );
}

/** The page's h1: the title as shown (it follows an edit at once). */
function PageHeading({ id }: { id: string }) {
  const { task } = useTaskDetail();
  return (
    <h1 id={id} tabIndex={-1} className="bo-text-display break-words outline-none">
      {task.title}
    </h1>
  );
}
