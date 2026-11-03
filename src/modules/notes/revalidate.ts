// What a change to `notes` revalidates (server only). Shared by the actions of `notes`.
import "server-only";
import { revalidatePath } from "next/cache";
import { HOME_PATH } from "@/lib/routes";
import { NOTES_PATH } from "./routes";

/**
 * After a save of the body: the list (its excerpt and order) and Hoy («Seguir la nota de hoy»),
 * but not the note's own page. Revalidating it would render the open note again on every autosave
 * (a second after each pause); its editor already holds what was saved.
 */
export function revalidateNoteLists() {
  revalidatePath(NOTES_PATH);
  revalidatePath(HOME_PATH);
}

/** After a change to a note itself (title, area, pin, delete, restore, create): every notes page. */
export function revalidateNotes() {
  revalidatePath(NOTES_PATH, "layout");
  revalidatePath(HOME_PATH);
}
