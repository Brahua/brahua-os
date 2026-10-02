// What a change to a habit revalidates (server only). Shared by the actions of `habits`.
import "server-only";
import { revalidatePath } from "next/cache";
import { HABITS_PATH } from "./routes";

/**
 * Every page under /habits ("Hoy", and from H5 on "Semana" and each habit's page): a single
 * user's pages are cheap to render again. H6 adds the home page (`today`) here.
 */
export function revalidateHabitScreens() {
  revalidatePath(HABITS_PATH, "layout");
}
