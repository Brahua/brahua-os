"use server";

// Server Actions for a project's links (P5). Through ownerAction(): owner check, Zod, then an
// ActionResult. In their own file (not actions.ts) so P3–P5, built in parallel, never collide.
// Every result revalidates the project's page, so a refusal also brings the current list.
import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import {
  addProjectLinkInputSchema,
  PROJECT_LINK_ERRORS,
  removeProjectLinkInputSchema,
  reorderProjectLinksInputSchema,
  updateProjectLinkInputSchema,
  type ProjectLinkSummary,
} from "./project-link-input";
import { PROJECT_ERRORS } from "./project-input";
import {
  deleteProjectLinkById,
  insertProjectLink,
  reorderProjectLinksByIds,
  updateProjectLinkById,
} from "./project-links";
import { projectPath } from "./routes";

type Links = { links: ProjectLinkSummary[] };

/** Revalidates the page and turns a data-layer outcome into a result. */
function result<T extends Links>(
  projectId: string,
  outcome: T | "linkNotFound" | "stale" | null,
): ActionResult<T> {
  revalidatePath(projectPath(projectId));
  if (outcome === null) return fail(PROJECT_ERRORS.notFound);
  if (outcome === "linkNotFound") return fail(PROJECT_LINK_ERRORS.notFound);
  if (outcome === "stale") return fail(PROJECT_LINK_ERRORS.staleOrder);
  return ok(outcome);
}

const add = ownerAction(
  addProjectLinkInputSchema,
  async (data) => result(data.projectId, await insertProjectLink(getDb(), data)),
  { name: "addProjectLink" },
);

/** Adds an http(s) link with an optional label, at the end (or at `position`, for undo). */
export async function addProjectLink(
  input: unknown,
): Promise<ActionResult<Links & { link: ProjectLinkSummary }>> {
  return add(input);
}

const update = ownerAction(
  updateProjectLinkInputSchema,
  async (data) => result(data.projectId, await updateProjectLinkById(getDb(), data)),
  { name: "updateProjectLink" },
);

/** Changes a link's URL and label. */
export async function updateProjectLink(input: unknown): Promise<ActionResult<Links>> {
  return update(input);
}

const remove = ownerAction(
  removeProjectLinkInputSchema,
  async (data) => result(data.projectId, await deleteProjectLinkById(getDb(), data)),
  { name: "removeProjectLink" },
);

/** Removes a link; the result has it and its position, for "Deshacer". */
export async function removeProjectLink(
  input: unknown,
): Promise<ActionResult<Links & { removed: ProjectLinkSummary; position: number }>> {
  return remove(input);
}

const reorder = ownerAction(
  reorderProjectLinksInputSchema,
  async ({ projectId, ids }) =>
    result(projectId, await reorderProjectLinksByIds(getDb(), projectId, ids)),
  { name: "reorderProjectLinks" },
);

/** Puts the project's links in the order of `ids` (exactly its links, or nothing changes). */
export async function reorderProjectLinks(input: unknown): Promise<ActionResult<Links>> {
  return reorder(input);
}
