// What a change to a task revalidates (server only). Shared by the actions of `tasks`.
import "server-only";
import { revalidatePath } from "next/cache";
import { PROJECTS_PATH } from "@/modules/projects/routes";
import { TASKS_PATH, taskPath } from "./routes";

/** The home page ("Hoy"): `today` shows the overdue and due-today tasks there (T6, D2). */
const HOME_PATH = "/";

/**
 * The project screens a task shows on (T5): its project's "Tareas" section and progress, and the
 * list's cards (progress and "Siguiente tarea"). Every page under /projects, because a change can
 * also take a task out of a project (a move, a delete) and the action doesn't know the old one;
 * a single user's pages are cheap to render again.
 */
export function revalidateProjectScreens() {
  revalidatePath(PROJECTS_PATH, "layout");
}

/**
 * Every screen that lists tasks: /tasks, the project screens and the home page, where `today`
 * shows the overdue and due-today ones (SPEC-today "Revalidación"). For changes without a task
 * page to refresh (creating; deleting, whose page would turn into its 404 under the user).
 */
export function revalidateTaskLists() {
  revalidatePath(TASKS_PATH);
  revalidateProjectScreens();
  revalidatePath(HOME_PATH);
}

/** The task lists (`revalidateTaskLists`) and the task's page (unless `page: false`). */
export function revalidateTaskScreens(id: string, { page = true }: { page?: boolean } = {}) {
  revalidateTaskLists();
  if (page) revalidatePath(taskPath(id));
}
