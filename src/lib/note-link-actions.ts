"use server";

// The `[[` picker's search (SPEC-notes "Selector `[[`"): a read-only Server Action next to the
// composition root of the link sources, so `notes` never imports the modules it searches. The note's
// page hands it to the editor as a prop. ownerAction(): owner check first, Zod, an ActionResult;
// a failure is logged with `describeError` only (never the text searched).
import { ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { NOTE_LINK_SOURCES } from "@/lib/note-link-sources";
import { ownerAction } from "@/lib/owner-action";
import type { NoteLinkGroup } from "@/modules/notes/contracts";
import { searchLinkTargets } from "@/modules/notes/links";
import { searchNoteLinksInputSchema } from "@/modules/notes/note-input";

const search = ownerAction(
  searchNoteLinksInputSchema,
  async ({ q }) => ok(await searchLinkTargets(getDb(), NOTE_LINK_SOURCES, q)),
  { name: "searchNoteLinks" },
);

/** Up to 8 targets whose name contains `q`, grouped by type. Writes nothing. */
export async function searchNoteLinks(input: unknown): Promise<ActionResult<NoteLinkGroup[]>> {
  return search(input);
}
