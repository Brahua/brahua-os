// What a change to `health` revalidates (server only). Shared by the actions of `health`.
import "server-only";
import { revalidatePath } from "next/cache";
import { HEALTH_PATH } from "./routes";

/**
 * Every page under /health (the routines, a routine's page, the catalogue and each exercise's
 * page). Nothing else shows `health` yet (Hoy and the weekly review come in E4). A single user's
 * pages are cheap to render again.
 */
export function revalidateHealth() {
  revalidatePath(HEALTH_PATH, "layout");
}
