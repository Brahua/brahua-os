// What a change made from the ritual revalidates (server only). Shared by the actions of
// `weekly-review`.
import "server-only";
import { revalidatePath } from "next/cache";
import { REVIEW_PATH } from "./routes";

/**
 * /review (every step and week: the route's cache is one). The task screens (/tasks, the projects
 * and Hoy) are revalidated by `tasks` itself inside `moveTasksToDate` / `undoMoveTasks`, so a
 * move needs nothing else here; W3's close adds /goals through `setWeeklyObjectiveForWeek`, which
 * revalidates it too.
 */
export function revalidateReviewScreens() {
  revalidatePath(REVIEW_PATH);
}
