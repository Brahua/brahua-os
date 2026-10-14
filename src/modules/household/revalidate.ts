// What a change to the household revalidates (server only). The task screens (/tasks, the
// projects and Hoy) are revalidated by `tasks` itself inside its contract functions.
import "server-only";
import { revalidatePath } from "next/cache";
import { HOUSEHOLD_PATH } from "./routes";

/** /household (every view and grouping: the route's cache is one). */
export function revalidateHousehold() {
  revalidatePath(HOUSEHOLD_PATH);
}
