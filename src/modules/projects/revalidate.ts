// What a change to a project revalidates (server only). Shared by the actions of `projects`.
import "server-only";
import { revalidatePath } from "next/cache";
import { HOME_PATH } from "@/lib/routes";
import { PROJECTS_PATH, projectPath } from "./routes";

/**
 * The list, the project's page and the home page, where `today` shows the projects due within a
 * week and the blocked ones (state, dates, priority, area, name or blockers change it).
 */
export function revalidateProjectScreens(id: string) {
  revalidatePath(PROJECTS_PATH);
  revalidatePath(projectPath(id));
  revalidatePath(HOME_PATH);
}

/**
 * The list and the home page, without the project's page (deleting: revalidating the page being
 * viewed would swap it for its 404 before the client leaves it).
 */
export function revalidateProjectListings() {
  revalidatePath(PROJECTS_PATH);
  revalidatePath(HOME_PATH);
}
