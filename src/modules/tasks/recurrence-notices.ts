// The list's notices around a recurring task (T3), pure: what "Tarea hecha" says when the
// completion created the next occurrence, and what "Deshacer" did with it.
import { formatDateKey } from "@/lib/time";
import { RECURRENCE_COPY } from "./recurrence-copy";
import type { SpawnInbox, SpawnUndo } from "./recurrence-db";
import type { TaskItem } from "./task-input";
import { TASKS_COPY } from "./tasks-copy";

/**
 * "«X» está hecha." or, with a next occurrence, "… La siguiente vence el 5 de octubre de 2026.",
 * plus why it is in the inbox when its place was closed.
 */
export function completedNotice(
  task: Pick<TaskItem, "title">,
  next: TaskItem | null,
  nextInbox: SpawnInbox | null = null,
): string {
  if (!next?.dueDate) return TASKS_COPY.completed(task.title);
  const done = RECURRENCE_COPY.completedNext(task.title, formatDateKey(next.dueDate));
  return nextInbox ? `${done} ${RECURRENCE_COPY.nextInInbox[nextInbox]}` : done;
}

/** "«X» volvió a tus tareas.", or that it came back as a task of its own. */
export function restoredNotice(task: Pick<TaskItem, "title">, detached: boolean): string {
  return detached ? RECURRENCE_COPY.restoredDetached(task.title) : TASKS_COPY.restored(task.title);
}

/** "«X» volvió a estar pendiente", and whether its next occurrence was removed or kept. */
export function reopenedNotice(task: Pick<TaskItem, "title">, spawn: SpawnUndo | null): string {
  if (spawn === "removed") return RECURRENCE_COPY.reopenedRemoved(task.title);
  if (spawn === "kept") return RECURRENCE_COPY.reopenedKept(task.title);
  return TASKS_COPY.reopened(task.title);
}
