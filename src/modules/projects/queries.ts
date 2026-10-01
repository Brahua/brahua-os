// Reads of `projects` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { ProjectSummary } from "./project-input";
import { selectProjectById, selectProjects } from "./projects";

/** Every project that isn't deleted, with its area. The page sorts and groups them. */
export async function listProjects(): Promise<ProjectSummary[]> {
  await requireOwner();
  return selectProjects(getDb());
}

const projectId = z.uuid();

/**
 * One project for its page, or null when the id is malformed, the project doesn't exist or it
 * is deleted. Cached per request: the page and its metadata share one query.
 */
export const getProject = cache(async (id: string): Promise<ProjectSummary | null> => {
  await requireOwner();
  // Not a uuid: no query (Postgres would reject the cast and quote the value in its error).
  if (!projectId.safeParse(id).success) return null;
  return selectProjectById(getDb(), id);
});
