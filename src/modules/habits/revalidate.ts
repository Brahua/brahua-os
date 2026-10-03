// What a change to a habit revalidates (server only). Shared by the actions of `habits`.
import "server-only";
import { revalidatePath } from "next/cache";
import { HOME_PATH } from "@/lib/routes";
import { HABITS_PATH } from "./routes";

/**
 * Every page under /habits ("Hoy", "Semana" and each habit's page) and the home page, where
 * `today` shows the habits due today (H6): a single user's pages are cheap to render again.
 */
export function revalidateHabitScreens() {
  revalidatePath(HABITS_PATH, "layout");
  revalidatePath(HOME_PATH);
}
