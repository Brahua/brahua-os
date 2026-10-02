"use server";

// Server Actions of the detail additions of T2 (notes and milestone). Through ownerAction():
// owner check, Zod, then an ActionResult. In their own file (not actions.ts) so T2–T4, built in
// parallel, never collide.
import { revalidatePath } from "next/cache";
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { projectPath } from "@/modules/projects/routes";
import {
  setTaskMilestoneInputSchema,
  taskMilestoneOptionsInputSchema,
  taskNotesInputSchema,
  updateTaskNotesInputSchema,
} from "./detail-input";
import {
  selectMilestoneOptions,
  setTaskMilestoneById,
  type TaskMilestoneOption,
} from "./milestone-data";
import { TASKS_PATH, taskPath } from "./routes";
import { TASK_ERRORS, type TaskItem } from "./task-input";
import { selectTaskNotes, setTaskNotes } from "./view-data";

const saveNotes = ownerAction(
  updateTaskNotesInputSchema,
  async ({ id, notes }) => {
    const saved = await setTaskNotes(getDb(), id, notes);
    // Only the task's page: the lists never show notes.
    revalidatePath(taskPath(id));
    return saved ? ok(saved) : fail(TASK_ERRORS.notFound);
  },
  { name: "updateTaskNotes" },
);

/** Saves a task's notes (Markdown, up to 20 000 characters); empty clears them. */
export async function updateTaskNotes(
  input: unknown,
): Promise<ActionResult<{ notes: string | null }>> {
  return saveNotes(input);
}

const readNotes = ownerAction(
  taskNotesInputSchema,
  async ({ id }) => {
    const found = await selectTaskNotes(getDb(), id);
    return found ? ok(found) : fail(TASK_ERRORS.notFound);
  },
  { name: "readTaskNotes" },
);

/**
 * A task's notes, for the detail sheet (the lists don't carry them; the task's page reads them
 * on the server). A read, but through ownerAction like the rest.
 */
export async function readTaskNotes(
  input: unknown,
): Promise<ActionResult<{ notes: string | null }>> {
  return readNotes(input);
}

const milestoneOptions = ownerAction(
  taskMilestoneOptionsInputSchema,
  async ({ projectId }) => ok(await selectMilestoneOptions(getDb(), projectId)),
  { name: "listTaskMilestones" },
);

/** The live milestones of a project (for the task's "Hito" picker), in their order. */
export async function listTaskMilestones(
  input: unknown,
): Promise<ActionResult<TaskMilestoneOption[]>> {
  return milestoneOptions(input);
}

const MILESTONE_FAILURES = {
  withoutProject: TASK_ERRORS.milestoneWithoutProject,
  milestoneUnavailable: TASK_ERRORS.milestoneUnavailable,
} as const;

const setMilestone = ownerAction(
  setTaskMilestoneInputSchema,
  async ({ id, milestoneId }) => {
    const result = await setTaskMilestoneById(getDb(), id, milestoneId);
    revalidatePath(TASKS_PATH);
    revalidatePath(taskPath(id));
    if (result === "notFound") return fail(TASK_ERRORS.notFound);
    if (typeof result === "string") {
      return {
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { milestoneId: [MILESTONE_FAILURES[result]] },
      };
    }
    // The project's page groups its tasks by milestone (T5).
    if (result.projectId) revalidatePath(projectPath(result.projectId));
    return ok(result);
  },
  { name: "setTaskMilestone" },
);

/**
 * Puts a task in one of its project's milestones (or none, with null). A milestone of another
 * project, a deleted one, or a task without a project are refused (error on `milestoneId`).
 */
export async function setTaskMilestone(input: unknown): Promise<ActionResult<TaskItem>> {
  return setMilestone(input);
}
