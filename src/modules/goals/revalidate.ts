// What a change to a goal revalidates (server only). Shared by the actions of `goals`.
import "server-only";
import { revalidatePath } from "next/cache";
import { GOALS_PATH } from "./routes";

/** Every page under /goals (the list and each goal's page): a single user's pages are cheap. */
export function revalidateGoalScreens() {
  revalidatePath(GOALS_PATH, "layout");
}
