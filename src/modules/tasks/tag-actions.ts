"use server";

// Server Actions of the tags of tasks (T4). Like actions.ts: each one goes through ownerAction()
// (owner check, then Zod, then an ActionResult); reachable by any POST, so input is `unknown`.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { TASKS_PATH, taskPath } from "./routes";
import { TASK_ERRORS, type TaskItem } from "./task-input";
import { setTaskTagsInputSchema } from "./task-tags";
import { replaceTaskTags, selectTagNames } from "./tags";
import { selectTaskById } from "./tasks";

const setTags = ownerAction(
  setTaskTagsInputSchema,
  async ({ id, tags }) => {
    const db = getDb();
    const found = await replaceTaskTags(db, id, tags);
    revalidatePath(TASKS_PATH);
    revalidatePath(taskPath(id));
    const task = found ? await selectTaskById(db, id) : null;
    return task ? ok(task) : fail(TASK_ERRORS.notFound);
  },
  { name: "setTaskTags" },
);

/**
 * Sets a task's tags (the whole set: what is missing is removed). Names are normalized
 * (lowercase, whitespace collapsed); a new one is created, an existing one reused. At most 10.
 * Only a visible task (not deleted, nor in a deleted project).
 */
export async function setTaskTags(input: unknown): Promise<ActionResult<TaskItem>> {
  return setTags(input);
}

const names = ownerAction(z.object({}), async () => ok(await selectTagNames(getDb())), {
  name: "listTaskTags",
});

/**
 * The tags in use, the most used first: what the tag field suggests. A read through ownerAction
 * (like listTaskTargets): the capture sheet opens from any screen and asks when it opens.
 */
export async function listTaskTags(input: unknown = {}): Promise<ActionResult<string[]>> {
  return names(input);
}
