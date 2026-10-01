"use server";

// Server Actions of `projects`. Each one goes through ownerAction(): owner check first, Zod, then
// an ActionResult (SPEC-core "Estilo de código"). Reachable by any POST, so input is `unknown`.
import { revalidatePath } from "next/cache";
import { INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { createProjectInputSchema, PROJECT_ERRORS, type ProjectSummary } from "./project-input";
import { insertProject } from "./projects";

const PROJECTS_PATH = "/projects";

const create = ownerAction(
  createProjectInputSchema,
  async (data) => {
    const project = await insertProject(getDb(), data);
    // Revalidate either way: when the area was archived since the form loaded, the response
    // brings the current areas.
    revalidatePath(PROJECTS_PATH);
    if (!project) {
      return {
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { lifeAreaId: [PROJECT_ERRORS.areaUnavailable] },
      };
    }
    return ok(project);
  },
  { name: "createProject" },
);

/**
 * Creates a project with its name, an active life area and its starting state (Idea by
 * default). Priority starts at medium; everything else is filled in later from its detail.
 */
export async function createProject(input: unknown): Promise<ActionResult<ProjectSummary>> {
  return create(input);
}
