// Reads of `projects` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { ActiveBlocker, ProjectDependencies } from "./dependency-input";
import type { DeletedProject, ProjectDetail, ProjectSummary } from "./project-input";
import {
  selectActiveBlockers,
  selectDeletedProjectById,
  selectProjectDependencies,
  selectProjectDetailById,
  selectProjects,
} from "./projects";

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
export const getProject = cache(async (id: string): Promise<ProjectDetail | null> => {
  await requireOwner();
  // Not a uuid: no query (Postgres would reject the cast and quote the value in its error).
  if (!projectId.safeParse(id).success) return null;
  return selectProjectDetailById(getDb(), id);
});

/**
 * A project that is deleted (for the list's "Proyecto eliminado · Deshacer" notice), or null
 * when the id is malformed, missing or the project isn't deleted (e.g. already restored).
 */
export async function getDeletedProject(id: string): Promise<DeletedProject | null> {
  await requireOwner();
  if (!projectId.safeParse(id).success) return null;
  return selectDeletedProjectById(getDb(), id);
}

/**
 * The blockers that still block, by project (only projects that have some): the list's
 * "Bloqueado" badges. One query for the whole list (SPEC-projects "Dependencias").
 */
export async function listActiveBlockers(): Promise<Record<string, ActiveBlocker[]>> {
  await requireOwner();
  const byProject: Record<string, ActiveBlocker[]> = {};
  for (const { projectId, id, name } of await selectActiveBlockers(getDb())) {
    (byProject[projectId] ??= []).push({ id, name });
  }
  return byProject;
}

/**
 * A project's blockers and the projects it may add (see selectProjectDependencies), or nothing
 * for a malformed id. The page renders its 404 from getProject either way.
 */
export async function getProjectDependencies(id: string): Promise<ProjectDependencies> {
  await requireOwner();
  if (!projectId.safeParse(id).success) return { blockers: [], blocking: [], candidates: [] };
  return selectProjectDependencies(getDb(), id);
}
