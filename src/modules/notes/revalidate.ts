// What a change to `notes` revalidates (server only). Shared by the actions of `notes`.
//
// Saving the body (`saveNote`, `saveDailyNote`, the autosave) revalidates NOTHING: in this Next,
// any `revalidatePath` inside a Server Action marks the response as revalidated and the open
// page is rendered again, a second after every pause while typing. It isn't needed: `/notes` and
// `/` are dynamic (they read the session and the search params), and dynamic pages are not kept
// in the client cache (`staleTimes.dynamic` defaults to 0 since Next 15), so a navigation asks the
// server for them again. Only the browser's back/forward restores them from that cache.
import "server-only";
import { revalidatePath } from "next/cache";
import { HOME_PATH } from "@/lib/routes";
import { NOTES_PATH } from "./routes";

/** After a change to a note itself (title, area, pin, delete, restore, create): every notes page. */
export function revalidateNotes() {
  revalidatePath(NOTES_PATH, "layout");
  revalidatePath(HOME_PATH);
}
