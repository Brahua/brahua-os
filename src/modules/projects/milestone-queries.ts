// Reads of a project's milestones for Server Components (P3). Each one checks the owner first.
import "server-only";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { MilestoneCounts, ProjectMilestoneItem } from "./milestone-input";
import { selectMilestoneCounts, selectMilestones } from "./milestones";

const projectId = z.uuid();

/** A project's milestones in order ([] for a malformed id: its page is a 404 anyway). */
export async function getProjectMilestones(id: string): Promise<ProjectMilestoneItem[]> {
  await requireOwner();
  if (!projectId.safeParse(id).success) return [];
  return selectMilestones(getDb(), id);
}

/** Done and total milestones per project id (only projects that have any), in one query. */
export async function listMilestoneCounts(): Promise<Record<string, MilestoneCounts>> {
  await requireOwner();
  return selectMilestoneCounts(getDb());
}
