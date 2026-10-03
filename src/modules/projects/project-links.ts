// Links data access (server only, P5). Callers check the owner and validate first. Every write
// runs in a transaction under the project's links lock and keeps `sort_order` contiguous
// (0…n-1) per project (SPEC-projects "Orden de hitos y enlaces").
import "server-only";
import { and, asc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { isSameIdSet } from "@/modules/core/life-area-order";
import { projectLinks, projects } from "./db/schema";
import { PROJECT_LINKS_KEY } from "./lock-keys";
import type { ProjectLinkSummary } from "./project-link-input";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const LINK = { id: projectLinks.id, url: projectLinks.url, label: projectLinks.label };

/**
 * Transaction-scoped lock for the writes to one project's links (add, edit, remove, reorder):
 * each reads the list and then writes positions, so two of them never interleave. Keyed by
 * the project (two ints: a namespace and the project), so other projects never wait.
 */
export function projectLinksLock(projectId: string) {
  return sql`select pg_advisory_xact_lock(hashtext(${PROJECT_LINKS_KEY}), hashtext(${projectId}))`;
}

/** A project's links in order. */
export async function selectProjectLinks(
  db: Database | Tx,
  projectId: string,
): Promise<ProjectLinkSummary[]> {
  return db
    .select(LINK)
    .from(projectLinks)
    .where(eq(projectLinks.projectId, projectId))
    .orderBy(asc(projectLinks.sortOrder), asc(projectLinks.id));
}

/** Whether the project exists and isn't deleted (links of a deleted project aren't edited). */
async function isActiveProject(tx: Tx, projectId: string): Promise<boolean> {
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
  return Boolean(project);
}

/** Lock, then check the project. Null when it doesn't exist or is deleted. */
async function withProjectLinks<T>(
  db: Database,
  projectId: string,
  write: (tx: Tx) => Promise<T>,
): Promise<T | null> {
  return db.transaction(async (tx) => {
    await tx.execute(projectLinksLock(projectId));
    if (!(await isActiveProject(tx, projectId))) return null;
    return write(tx);
  });
}

export type LinkWrite = { links: ProjectLinkSummary[] };

/**
 * Adds a link at `position` (0-based; missing or past the end: at the end), shifting the ones
 * after it. Returns the project's links, or null when the project doesn't exist or is deleted.
 */
export async function insertProjectLink(
  db: Database,
  input: { projectId: string; url: string; label: string | null; position?: number },
): Promise<(LinkWrite & { link: ProjectLinkSummary }) | null> {
  return withProjectLinks(db, input.projectId, async (tx) => {
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::integer` })
      .from(projectLinks)
      .where(eq(projectLinks.projectId, input.projectId));
    const position = Math.min(input.position ?? count, count);
    if (position < count) {
      await tx
        .update(projectLinks)
        .set({ sortOrder: sql`${projectLinks.sortOrder} + 1` })
        .where(
          and(eq(projectLinks.projectId, input.projectId), gte(projectLinks.sortOrder, position)),
        );
    }
    const [link] = await tx
      .insert(projectLinks)
      .values({
        projectId: input.projectId,
        url: input.url,
        label: input.label,
        sortOrder: position,
      })
      .returning(LINK);
    return { link, links: await selectProjectLinks(tx, input.projectId) };
  });
}

/**
 * Changes a link's URL and label. `"linkNotFound"` when the link doesn't exist or belongs to
 * another project (never edited through the wrong project); null when the project doesn't
 * exist or is deleted.
 */
export async function updateProjectLinkById(
  db: Database,
  input: { projectId: string; id: string; url: string; label: string | null },
): Promise<LinkWrite | "linkNotFound" | null> {
  return withProjectLinks(db, input.projectId, async (tx) => {
    const updated = await tx
      .update(projectLinks)
      .set({ url: input.url, label: input.label })
      .where(and(eq(projectLinks.id, input.id), eq(projectLinks.projectId, input.projectId)))
      .returning({ id: projectLinks.id });
    if (updated.length === 0) return "linkNotFound" as const;
    return { links: await selectProjectLinks(tx, input.projectId) };
  });
}

/**
 * Removes a link (the row goes; "Deshacer" adds it back at `position`) and closes the gap.
 * Same results as editing.
 */
export async function deleteProjectLinkById(
  db: Database,
  input: { projectId: string; id: string },
): Promise<
  (LinkWrite & { removed: ProjectLinkSummary; position: number }) | "linkNotFound" | null
> {
  return withProjectLinks(db, input.projectId, async (tx) => {
    const [removed] = await tx
      .delete(projectLinks)
      .where(and(eq(projectLinks.id, input.id), eq(projectLinks.projectId, input.projectId)))
      .returning({ ...LINK, sortOrder: projectLinks.sortOrder });
    if (!removed) return "linkNotFound" as const;
    await tx
      .update(projectLinks)
      .set({ sortOrder: sql`${projectLinks.sortOrder} - 1` })
      .where(
        and(
          eq(projectLinks.projectId, input.projectId),
          gt(projectLinks.sortOrder, removed.sortOrder),
        ),
      );
    const { sortOrder: position, ...link } = removed;
    return { removed: link, position, links: await selectProjectLinks(tx, input.projectId) };
  });
}

/**
 * Rewrites the order of a project's links (one statement, only the rows that move).
 * `"stale"` (writing nothing) when `ids` isn't exactly the project's links: a list changed in
 * another tab, or a tampered request (another project's link included). Null when the project
 * doesn't exist or is deleted.
 */
export async function reorderProjectLinksByIds(
  db: Database,
  projectId: string,
  ids: readonly string[],
): Promise<LinkWrite | "stale" | null> {
  return withProjectLinks(db, projectId, async (tx) => {
    const rows = await tx
      .select({ id: projectLinks.id, sortOrder: projectLinks.sortOrder })
      .from(projectLinks)
      .where(eq(projectLinks.projectId, projectId));
    if (
      !isSameIdSet(
        rows.map((row) => row.id),
        ids,
      )
    ) {
      return "stale" as const;
    }
    const current = new Map(rows.map((row) => [row.id, row.sortOrder]));
    const changed = ids
      .map((id, index) => ({ id, index }))
      .filter(({ id, index }) => current.get(id) !== index);
    if (changed.length > 0) {
      const position = sql.join(
        changed.map(({ id, index }) => sql`when ${id}::uuid then ${index}::integer`),
        sql` `,
      );
      await tx
        .update(projectLinks)
        .set({ sortOrder: sql`case ${projectLinks.id} ${position} end` })
        .where(
          and(
            eq(projectLinks.projectId, projectId),
            sql`${projectLinks.id} in (${sql.join(
              changed.map(({ id }) => sql`${id}::uuid`),
              sql`, `,
            )})`,
          ),
        );
    }
    return { links: await selectProjectLinks(tx, projectId) };
  });
}
