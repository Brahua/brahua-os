// What a change to `learning` revalidates (server only). Shared by the actions of `learning`.
import "server-only";
import { revalidatePath } from "next/cache";
import { LEARNING_PATH } from "./routes";

/**
 * Every page under /learning (the list and each track's page): a single user's pages are cheap to
 * render again. L3 adds what shows tracks elsewhere (Hoy, a project's progress).
 */
export function revalidateLearning() {
  revalidatePath(LEARNING_PATH, "layout");
}
