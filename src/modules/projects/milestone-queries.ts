// Reads of a project's milestones for Server Components (P3). Each one checks the owner first.
import "server-only";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { ProjectMilestoneItem } from "./milestone-input";
import { selectMilestoneViews } from "./milestone-views";

const projectId = z.uuid();

/**
 * A project's milestones in order, each with the state derived from its tasks ([] for a malformed
 * id: its page is a 404 anyway).
 */
export async function getProjectMilestones(id: string): Promise<ProjectMilestoneItem[]> {
  await requireOwner();
  if (!projectId.safeParse(id).success) return [];
  return selectMilestoneViews(getDb(), id);
}
