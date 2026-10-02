// Reads of a project's links for its page (P5). Checks the owner first (SPEC-core).
import "server-only";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { ProjectLinkSummary } from "./project-link-input";
import { selectProjectLinks } from "./project-links";

const projectId = z.uuid();

/** A project's links in order (none for a malformed id: no query). */
export async function listProjectLinks(id: string): Promise<ProjectLinkSummary[]> {
  await requireOwner();
  if (!projectId.safeParse(id).success) return [];
  return selectProjectLinks(getDb(), id);
}
