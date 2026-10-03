// What a change to a habit revalidates (server only). Shared by the actions of `habits`.
import "server-only";
import { revalidatePath } from "next/cache";
import { HABITS_PATH } from "./routes";

/** The home page ("Hoy"): the `today` module shows the habits due today there (H6). */
const HOME_PATH = "/";

/**
 * Every page under /habits ("Hoy", "Semana" and each habit's page) and the home page, where
 * `today` shows the habits due today (H6): a single user's pages are cheap to render again.
 */
export function revalidateHabitScreens() {
  revalidatePath(HABITS_PATH, "layout");
  revalidatePath(HOME_PATH);
}
