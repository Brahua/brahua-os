// The optimistic view of a list of tasks (the inbox in T1; the views of T2). Pure and
// client-safe: the list applies a change at once and the server's answer (the page revalidates)
// replaces it.
import type { TaskItem } from "./task-input";
import { compareByDue } from "./task-views";

export type TaskListChange =
  /** Leaves the list (completed, moved out, deleted). */
  | { type: "remove"; id: string }
  /** Comes back ("Deshacer") at its old place; replaces it if the list already has it. */
  | { type: "restore"; task: TaskItem; index: number }
  /** Changes in place. */
  | { type: "update"; id: string; patch: Partial<TaskItem> }
  /**
   * A new due date ("Mañana", "Otro día…", their "Deshacer"): the row takes its place in the
   * views' order (`compareByDue`), so a grouped list never shows a day twice.
   */
  | { type: "reschedule"; id: string; dueDate: string | null };

export function applyTaskListChange(list: TaskItem[], change: TaskListChange): TaskItem[] {
  switch (change.type) {
    case "remove":
      return list.filter((task) => task.id !== change.id);
    case "restore": {
      if (list.some((task) => task.id === change.task.id)) {
        return list.map((task) => (task.id === change.task.id ? change.task : task));
      }
      const at = Math.max(0, Math.min(change.index, list.length));
      return [...list.slice(0, at), change.task, ...list.slice(at)];
    }
    case "update":
      return list.map((task) => (task.id === change.id ? { ...task, ...change.patch } : task));
    case "reschedule":
      return list
        .map((task) =>
          task.id === change.id
            ? // A time needs a day: no day, no time (the server does the same).
              { ...task, dueDate: change.dueDate, ...(change.dueDate === null ? { dueTime: null } : {}) }
            : task,
        )
        .sort(compareByDue);
  }
}

/** The task to focus when `id` leaves the list: the next one, else the previous, else none. */
export function neighborOf(list: readonly TaskItem[], id: string): TaskItem | null {
  const index = list.findIndex((task) => task.id === id);
  if (index === -1) return null;
  return list[index + 1] ?? list[index - 1] ?? null;
}
