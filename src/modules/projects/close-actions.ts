"use server";

// "Cerrar proyecto" (Checkpoint final de projects): Terminado and Cancelado as a separate,
// confirmed action, and "Reabrir". Each one goes through ownerAction() like the rest.
// P6: registers the progress sources of other modules (tasks), so the open count includes them.
import { ensureProgressSources } from "@/lib/progress-sources";
import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { contributedProgress } from "./contracts";
import { selectProjectMilestoneCounts } from "./milestones";
import { openWork, type OpenWork } from "./project-close";
import {
  closeProjectInputSchema,
  PROJECT_ERRORS,
  projectIdInputSchema,
  type ProjectSummary,
} from "./project-input";
import { reopenProjectById, setProjectStatus } from "./projects";
import { PROJECTS_PATH, projectPath } from "./routes";

export type ClosedProject = { project: ProjectSummary; open: OpenWork };

function revalidateProject(id: string) {
  revalidatePath(PROJECTS_PATH);
  revalidatePath(projectPath(id));
}

const close = ownerAction(
  closeProjectInputSchema,
  async ({ id, status }) => {
    const db = getDb();
    const project = await setProjectStatus(db, id, status);
    revalidateProject(id);
    if (!project) return fail(PROJECT_ERRORS.notFound);
    // Counted again here, after closing, only for the text of the result ("Quedaron 2 hitos
    // abiertos."): open work never blocks closing, the owner already decided.
    ensureProgressSources();
    const [milestones, contributed] = await Promise.all([
      selectProjectMilestoneCounts(db, id),
      contributedProgress([id]),
    ]);
    return ok({ project, open: openWork(milestones, contributed.get(id)) });
  },
  { name: "closeProject" },
);

/**
 * Closes a project as Terminado (stamps `completed_at`, keeping the original date if it was
 * already done) or Cancelado (clears it), whatever is still open. Returns the project and what
 * was left open: its milestones not done and the units the progress sources (tasks) count.
 */
export async function closeProject(input: unknown): Promise<ActionResult<ClosedProject>> {
  return close(input);
}

const reopen = ownerAction(
  projectIdInputSchema,
  async ({ id }) => {
    const project = await reopenProjectById(getDb(), id);
    revalidateProject(id);
    return project ? ok(project) : fail(PROJECT_ERRORS.notFound);
  },
  { name: "reopenProject" },
);

/**
 * "Reabrir": a Terminado or Cancelado project goes back to Activo (`completed_at` cleared). One
 * that is already open stays as it is.
 */
export async function reopenProject(input: unknown): Promise<ActionResult<ProjectSummary>> {
  return reopen(input);
}
