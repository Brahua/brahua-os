// What a change to a task revalidates (server only). Shared by the actions of `tasks`.
import "server-only";
import { revalidatePath } from "next/cache";
import { PROJECTS_PATH } from "@/modules/projects/routes";
import { TASKS_PATH, taskPath } from "./routes";

/**
 * The project screens a task shows on (T5): its project's "Tareas" section and progress, and the
 * list's cards (progress and "Siguiente tarea"). Every page under /projects, because a change can
 * also take a task out of a project (a move, a delete) and the action doesn't know the old one;
 * a single user's pages are cheap to render again.
 */
export function revalidateProjectScreens() {
  revalidatePath(PROJECTS_PATH, "layout");
}

/** The list, the task's page (unless `page: false`) and the project screens. */
export function revalidateTaskScreens(id: string, { page = true }: { page?: boolean } = {}) {
  revalidatePath(TASKS_PATH);
  if (page) revalidatePath(taskPath(id));
  revalidateProjectScreens();
}
