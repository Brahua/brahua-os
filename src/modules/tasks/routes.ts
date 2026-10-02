// URLs of the tasks screens. Client-safe.

export const TASKS_PATH = "/tasks";

/** A task's page (the detail on the phone; on the desktop it opens in a side sheet). */
export const taskPath = (id: string) => `${TASKS_PATH}/${id}`;

/** `?vista=` picks the view of /tasks (SPEC-tasks "Pantallas"). */
export const VIEW_PARAM = "vista";

/** The views of /tasks, in tab order. Only the inbox exists in T1; T2 builds the rest. */
export const TASK_VIEWS = ["bandeja", "hoy", "proximas", "todas", "hechas"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

/** The view of a `?vista=` value; anything unknown (or missing) is the inbox. */
export function parseTaskView(value: string | string[] | undefined): TaskView {
  return typeof value === "string" && (TASK_VIEWS as readonly string[]).includes(value)
    ? (value as TaskView)
    : "bandeja";
}

/** The link of a view (the inbox is the bare /tasks). */
export const taskViewHref = (view: TaskView) =>
  view === "bandeja" ? TASKS_PATH : `${TASKS_PATH}?${VIEW_PARAM}=${view}`;

/**
 * `?deleted=<id>` on the list: that task was just deleted from its page. The list shows the
 * "Tarea eliminada · Deshacer" notice and drops the parameter.
 */
export const DELETED_PARAM = "deleted";
