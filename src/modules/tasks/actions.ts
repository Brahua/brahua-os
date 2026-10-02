"use server";

// Server Actions of `tasks`. Each one goes through ownerAction(): owner check first, Zod, then an
// ActionResult (SPEC-core "Estilo de código"). Reachable by any POST, so input is `unknown`.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, INVALID_FIELDS_MESSAGE, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import {
  createTaskInputSchema,
  editTaskInputSchema,
  TASK_ERRORS,
  taskIdInputSchema,
  type DeletedTask,
  type TaskItem,
  type TaskTargets,
} from "./task-input";
import {
  completeTaskById,
  insertTask,
  reopenTaskById,
  restoreTaskById,
  selectTaskTargets,
  softDeleteTask,
  updateTask,
  type PlacementFailure,
} from "./tasks";
import { revalidateProjectScreens, revalidateTaskScreens } from "./revalidate";
import { TASKS_PATH } from "./routes";

/** The list, the task's page and (T5) the project screens all show what changed. */
function revalidateTask(id: string) {
  revalidateTaskScreens(id);
}

/** The field a refused placement belongs to, with its message. */
const PLACEMENT_FIELDS: Record<PlacementFailure, ["lifeAreaId" | "projectId" | "milestoneId", string]> =
  {
    areaUnavailable: ["lifeAreaId", TASK_ERRORS.areaUnavailable],
    projectUnavailable: ["projectId", TASK_ERRORS.projectUnavailable],
    milestoneUnavailable: ["milestoneId", TASK_ERRORS.milestoneUnavailable],
  };

function refused<T>(failure: PlacementFailure, prefix = ""): ActionResult<T> {
  const [field, message] = PLACEMENT_FIELDS[failure];
  return { ok: false, error: INVALID_FIELDS_MESSAGE, fieldErrors: { [prefix + field]: [message] } };
}

const create = ownerAction(
  createTaskInputSchema,
  async (data) => {
    const task = await insertTask(getDb(), data);
    // Revalidate either way: a refusal means the page's areas or projects were out of date.
    revalidatePath(TASKS_PATH);
    revalidateProjectScreens();
    return typeof task === "string" ? refused<TaskItem>(task) : ok(task);
  },
  { name: "createTask" },
);

/**
 * Creates a task (quick capture): a title, and optionally an active area or an open project
 * (with one of its milestones), a due date and a priority (Media by default). Without an area or
 * a project it lands in the inbox.
 */
export async function createTask(input: unknown): Promise<ActionResult<TaskItem>> {
  return create(input);
}

const edit = ownerAction(
  editTaskInputSchema,
  async (data) => {
    const task = await updateTask(getDb(), data);
    revalidateTask(data.id);
    if (task === null) return fail(TASK_ERRORS.notFound);
    return typeof task === "string" ? refused<TaskItem>(task, "placement.") : ok(task);
  },
  { name: "editTask" },
);

/**
 * Edits a task's own fields: any of title, priority, due date (null clears it) and placement
 * (area, project and milestone together; with a project, the area is the project's). A milestone
 * of another project, an archived area or a closed project are refused (error on that field).
 */
export async function editTask(input: unknown): Promise<ActionResult<TaskItem>> {
  return edit(input);
}

const complete = ownerAction(
  taskIdInputSchema,
  async ({ id }) => {
    const result = await completeTaskById(getDb(), id);
    revalidateTask(id);
    return result ? ok(result.task) : fail(TASK_ERRORS.notFound);
  },
  { name: "completeTask" },
);

/** Marks a task done. Completing it twice keeps the first date (a double tap does nothing). */
export async function completeTask(input: unknown): Promise<ActionResult<TaskItem>> {
  return complete(input);
}

const reopen = ownerAction(
  taskIdInputSchema,
  async ({ id }) => {
    const result = await reopenTaskById(getDb(), id);
    revalidateTask(id);
    return result ? ok(result.task) : fail(TASK_ERRORS.notFound);
  },
  { name: "reopenTask" },
);

/** "Deshacer" of a completion: the task is pending again (twice changes nothing). */
export async function reopenTask(input: unknown): Promise<ActionResult<TaskItem>> {
  return reopen(input);
}

const remove = ownerAction(
  taskIdInputSchema,
  async ({ id }) => {
    const deleted = await softDeleteTask(getDb(), id);
    // Only the list: revalidating the task's page now would swap it for its 404 before the
    // client leaves it.
    revalidatePath(TASKS_PATH);
    revalidateProjectScreens();
    return deleted ? ok(deleted) : fail(TASK_ERRORS.notFound);
  },
  { name: "deleteTask" },
);

/** Soft delete (SPEC-tasks "Borrar"): out of every view, back with "Deshacer". */
export async function deleteTask(input: unknown): Promise<ActionResult<DeletedTask>> {
  return remove(input);
}

const restore = ownerAction(
  taskIdInputSchema,
  async ({ id }) => {
    const restored = await restoreTaskById(getDb(), id);
    revalidateTask(id);
    return restored ? ok(restored.task) : fail(TASK_ERRORS.notFound);
  },
  { name: "restoreTask" },
);

/** "Deshacer" of a delete. Restoring twice is not an error. */
export async function restoreTask(input: unknown): Promise<ActionResult<TaskItem>> {
  return restore(input);
}

const targets = ownerAction(
  z.object({}),
  async () => ok(await selectTaskTargets(getDb())),
  { name: "listTaskTargets" },
);

/**
 * Where a task can go (the active areas and the open projects), for the quick capture sheet. It
 * opens from any screen, so it asks when it opens instead of every page loading them (and stays
 * current: a project created a minute ago is there). A read, but through ownerAction like the
 * rest: the owner check is the same.
 */
export async function listTaskTargets(input: unknown = {}): Promise<ActionResult<TaskTargets>> {
  return targets(input);
}
