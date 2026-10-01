"use server";

// Server Actions of a project's milestones (P3). Each one goes through ownerAction(): owner check
// first, Zod, then an ActionResult. Reachable by any POST, so input is `unknown`; every write
// names the project and the data layer checks the milestone belongs to it.
import { revalidatePath } from "next/cache";
import { fail, ok, UNEXPECTED_ERROR_MESSAGE, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import {
  addMilestoneInputSchema,
  MILESTONE_ERRORS,
  milestoneRefInputSchema,
  reorderMilestonesInputSchema,
  restoreMilestoneInputSchema,
  setMilestoneDoneInputSchema,
  updateMilestoneInputSchema,
  type ProjectMilestoneItem,
} from "./milestone-input";
import {
  deleteMilestone as removeMilestone,
  insertMilestone,
  reorderMilestonesByIds,
  restoreMilestone as putBackMilestone,
  setMilestoneDetails,
  setMilestoneDone,
} from "./milestones";
import { PROJECT_ERRORS } from "./project-input";
import { PROJECTS_PATH, projectPath } from "./routes";

/** Failures of the data layer, as the owner reads them. */
const FAILURES = {
  projectNotFound: PROJECT_ERRORS.notFound,
  milestoneNotFound: MILESTONE_ERRORS.notFound,
  tooMany: MILESTONE_ERRORS.tooMany,
  // Only a tampered request (or a uuid collision) reuses an id.
  idTaken: UNEXPECTED_ERROR_MESSAGE,
  staleOrder: MILESTONE_ERRORS.staleOrder,
} as const;

type Failure = keyof typeof FAILURES;

/**
 * The result of a milestone write. Revalidates the project's page and the list (its cards show
 * the progress) either way: after a refusal, the response brings the current milestones (or the
 * page's 404 when the project was deleted).
 */
function result<T>(projectId: string, value: T | Failure): ActionResult<T> {
  revalidatePath(PROJECTS_PATH);
  revalidatePath(projectPath(projectId));
  if (typeof value === "string" && value in FAILURES) return fail(FAILURES[value as Failure]);
  return ok(value as T);
}

const add = ownerAction(
  addMilestoneInputSchema,
  async (data) => result(data.projectId, await insertMilestone(getDb(), data)),
  { name: "addMilestone" },
);

/** Adds a milestone at the end of the project's list (title only; the date is edited later). */
export async function addMilestone(input: unknown): Promise<ActionResult<ProjectMilestoneItem>> {
  return add(input);
}

const update = ownerAction(
  updateMilestoneInputSchema,
  async (data) => result(data.projectId, await setMilestoneDetails(getDb(), data)),
  { name: "updateMilestone" },
);

/** Sets a milestone's title (1–120) and optional due date. */
export async function updateMilestone(input: unknown): Promise<ActionResult<ProjectMilestoneItem>> {
  return update(input);
}

const check = ownerAction(
  setMilestoneDoneInputSchema,
  async (data) => result(data.projectId, await setMilestoneDone(getDb(), data)),
  { name: "setMilestoneDone" },
);

/** The checkbox: done stamps `done_at` (kept if it already was), pending clears it. */
export async function checkMilestone(input: unknown): Promise<ActionResult<ProjectMilestoneItem>> {
  return check(input);
}

const remove = ownerAction(
  milestoneRefInputSchema,
  async (data) => result(data.projectId, await removeMilestone(getDb(), data)),
  { name: "deleteMilestone" },
);

/** Deletes a milestone; the result carries what "Deshacer" needs (the row and its position). */
export async function deleteMilestone(
  input: unknown,
): Promise<ActionResult<{ milestone: ProjectMilestoneItem; position: number }>> {
  return remove(input);
}

const restore = ownerAction(
  restoreMilestoneInputSchema,
  async (data) => result(data.projectId, await putBackMilestone(getDb(), data)),
  { name: "restoreMilestone" },
);

/** "Deshacer" after deleting: the same milestone back in its place. Twice changes nothing. */
export async function restoreMilestone(
  input: unknown,
): Promise<ActionResult<ProjectMilestoneItem[]>> {
  return restore(input);
}

const reorder = ownerAction(
  reorderMilestonesInputSchema,
  async ({ projectId, ids }) =>
    result(projectId, await reorderMilestonesByIds(getDb(), projectId, ids)),
  { name: "reorderMilestones" },
);

/**
 * Writes the new order. A list that isn't exactly the project's milestones (stale or tampered
 * with) is refused without writing anything, and the response brings the current list.
 */
export async function reorderMilestones(
  input: unknown,
): Promise<ActionResult<ProjectMilestoneItem[]>> {
  return reorder(input);
}
