"use server";

// Server Actions of `projects`. Each one goes through ownerAction(): owner check first, Zod, then
// an ActionResult (SPEC-core "Estilo de código"). Reachable by any POST, so input is `unknown`.
import { revalidatePath } from "next/cache";
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import {
  changeProjectAreaInputSchema,
  changeProjectPriorityInputSchema,
  changeProjectStatusInputSchema,
  createProjectInputSchema,
  PROJECT_ERRORS,
  projectIdInputSchema,
  renameProjectInputSchema,
  updateProjectDatesInputSchema,
  updateProjectObjectiveInputSchema,
  type DeletedProject,
  type ProjectSummary,
} from "./project-input";
import {
  insertProject,
  restoreProjectById,
  setProjectArea,
  setProjectDates,
  setProjectName,
  setProjectObjective,
  setProjectPriority,
  setProjectStatus,
  softDeleteProject,
} from "./projects";
import { PROJECTS_PATH, projectPath } from "./routes";

/** The list and the project's page both show what changed. */
function revalidateProject(id: string) {
  revalidatePath(PROJECTS_PATH);
  revalidatePath(projectPath(id));
}

/**
 * The result of a write to one project: the project as saved, or "not found" when it doesn't
 * exist or was deleted (in another tab, say). Revalidates either way, so the page catches up
 * (a deleted project's page becomes its 404).
 */
function saved<T>(id: string, project: T | null): ActionResult<T> {
  revalidateProject(id);
  return project ? ok(project) : fail(PROJECT_ERRORS.notFound);
}

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

const rename = ownerAction(
  renameProjectInputSchema,
  async ({ id, name }) => saved(id, await setProjectName(getDb(), id, name)),
  { name: "renameProject" },
);

/** Renames a project (1–80 characters, normalized like when creating). */
export async function renameProject(input: unknown): Promise<ActionResult<ProjectSummary>> {
  return rename(input);
}

const changeStatus = ownerAction(
  changeProjectStatusInputSchema,
  async ({ id, status }) => saved(id, await setProjectStatus(getDb(), id, status)),
  { name: "changeProjectStatus" },
);

/**
 * Moves a project to any of the six states. Terminado stamps `completed_at` (kept if it was
 * already done); leaving Terminado clears it.
 */
export async function changeProjectStatus(input: unknown): Promise<ActionResult<ProjectSummary>> {
  return changeStatus(input);
}

const changePriority = ownerAction(
  changeProjectPriorityInputSchema,
  async ({ id, priority }) => saved(id, await setProjectPriority(getDb(), id, priority)),
  { name: "changeProjectPriority" },
);

/** Baja, Media or Alta. */
export async function changeProjectPriority(input: unknown): Promise<ActionResult<ProjectSummary>> {
  return changePriority(input);
}

const changeArea = ownerAction(
  changeProjectAreaInputSchema,
  async ({ id, lifeAreaId }) => {
    const project = await setProjectArea(getDb(), id, lifeAreaId);
    if (project !== "areaUnavailable") return saved(id, project);
    // Revalidated too: an area archived meanwhile drops out of the page's choices.
    revalidateProject(id);
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { lifeAreaId: [PROJECT_ERRORS.areaUnavailable] },
    };
  },
  { name: "changeProjectArea" },
);

/** Moves a project to another active area (its own area, even archived, changes nothing). */
export async function changeProjectArea(input: unknown): Promise<ActionResult<ProjectSummary>> {
  return changeArea(input);
}

const changeObjective = ownerAction(
  updateProjectObjectiveInputSchema,
  async ({ id, objective }) => saved(id, await setProjectObjective(getDb(), id, objective)),
  { name: "updateProjectObjective" },
);

/** Sets the objective (one paragraph, up to 280 characters); empty clears it. */
export async function updateProjectObjective(
  input: unknown,
): Promise<ActionResult<ProjectSummary>> {
  return changeObjective(input);
}

const changeDates = ownerAction(
  updateProjectDatesInputSchema,
  async ({ id, startDate, dueDate }) =>
    saved(id, await setProjectDates(getDb(), id, { startDate, dueDate })),
  { name: "updateProjectDates" },
);

/** Sets both dates (each optional); the end can't be before the start. */
export async function updateProjectDates(input: unknown): Promise<ActionResult<ProjectSummary>> {
  return changeDates(input);
}

const remove = ownerAction(
  projectIdInputSchema,
  async ({ id }) => {
    const project = await softDeleteProject(getDb(), id);
    // Only the list: revalidating the page being viewed would swap it for its 404 before the
    // client's router.replace leaves it.
    revalidatePath(PROJECTS_PATH);
    return project ? ok(project) : fail(PROJECT_ERRORS.notFound);
  },
  { name: "deleteProject" },
);

/** Soft delete ("Eliminar"): out of every view, kept in the export, undone with restoreProject. */
export async function deleteProject(input: unknown): Promise<ActionResult<DeletedProject>> {
  return remove(input);
}

const restore = ownerAction(
  projectIdInputSchema,
  async ({ id }) => saved(id, await restoreProjectById(getDb(), id)),
  { name: "restoreProject" },
);

/** "Deshacer" after deleting. Restoring one that isn't deleted changes nothing. */
export async function restoreProject(input: unknown): Promise<ActionResult<ProjectSummary>> {
  return restore(input);
}
