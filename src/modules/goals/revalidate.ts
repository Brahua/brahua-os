// What a change to a goal revalidates (server only). Shared by the actions of `goals`.
import "server-only";
import { revalidatePath } from "next/cache";
// Route constants only (client-safe URL helpers: the one thing of `habits` and `projects` besides
// their contracts that `goals` may import, see eslint.config.mjs).
import { HABITS_PATH } from "@/modules/habits/routes";
import { PROJECTS_PATH } from "@/modules/projects/routes";
import { GOALS_PATH } from "./routes";

/**
 * Every page under /goals (the list and each goal's page) and, since a habit's and a project's
 * pages list the goals that follow them (the "Metas" section of src/lib/goal-extensions.ts),
 * every page under /habits and /projects: a single user's pages are cheap to render again.
 */
export function revalidateGoalScreens() {
  revalidatePath(GOALS_PATH, "layout");
  revalidatePath(HABITS_PATH, "layout");
  revalidatePath(PROJECTS_PATH, "layout");
}

/** The weekly objective is only shown on /goals. */
export function revalidateWeeklyObjective() {
  revalidatePath(GOALS_PATH, "layout");
}
