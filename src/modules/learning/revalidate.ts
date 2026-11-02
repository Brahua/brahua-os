// What a change to `learning` revalidates (server only). Shared by the actions of `learning`.
import "server-only";
import { revalidatePath } from "next/cache";
import { HOME_PATH } from "@/lib/routes";
import { PROJECTS_PATH } from "@/modules/projects/routes";
import { LEARNING_PATH } from "./routes";

/**
 * Every page under /learning (the list and each track's page), and what shows tracks elsewhere
 * (L3): Hoy's «Estudio» and the projects' progress (a track linked to a project counts in it, on
 * the list and each project's page). A single user's pages are cheap to render again.
 */
export function revalidateLearning() {
  revalidatePath(LEARNING_PATH, "layout");
  revalidatePath(HOME_PATH);
  revalidatePath(PROJECTS_PATH, "layout");
}
