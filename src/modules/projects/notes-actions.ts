"use server";

// Server Action for a project's notes (P5). Through ownerAction(): owner check, Zod, then an
// ActionResult. In its own file (not actions.ts) so P3–P5, built in parallel, never collide.
import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { PROJECT_ERRORS } from "./project-input";
import { setProjectNotes } from "./project-notes";
import { updateProjectNotesInputSchema } from "./project-notes-input";
import { projectPath } from "./routes";

const saveNotes = ownerAction(
  updateProjectNotesInputSchema,
  async ({ id, notes }) => {
    const saved = await setProjectNotes(getDb(), id, notes);
    // Only the page: the list never shows notes. A deleted project's page becomes its 404.
    revalidatePath(projectPath(id));
    return saved ? ok(saved) : fail(PROJECT_ERRORS.notFound);
  },
  { name: "updateProjectNotes" },
);

/** Saves a project's notes (Markdown, up to 20 000 characters); empty clears them. */
export async function updateProjectNotes(
  input: unknown,
): Promise<ActionResult<{ notes: string | null }>> {
  return saveNotes(input);
}
