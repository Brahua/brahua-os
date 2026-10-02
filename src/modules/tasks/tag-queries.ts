// Reads of the tags of tasks for Server Components (T4). Each one checks the owner first.
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { TaskTagSummary } from "./task-input";
import { selectTagOptions } from "./tags";

/** The tags in use (id and name), the most used first: the options of the tag filter. */
export async function getTaskTagOptions(): Promise<TaskTagSummary[]> {
  await requireOwner();
  return selectTagOptions(getDb());
}
