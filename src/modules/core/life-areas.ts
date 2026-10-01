// Life areas data access (server only). These functions take the database and trust their
// input: callers check the owner and validate first (the actions through ownerAction(), the
// queries with requireOwner()).
import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { slugify, uniqueSlug } from "@/lib/text";
import { lifeAreas } from "./db/schema";
import type {
  LifeAreaInput,
  LifeAreaSummary,
  UnarchiveLifeAreaInput,
  UpdateLifeAreaInput,
} from "./life-area-input";
import { planReorder } from "./life-area-order";

export type { LifeAreaSummary } from "./life-area-input";

const SUMMARY = {
  id: lifeAreas.id,
  slug: lifeAreas.slug,
  name: lifeAreas.name,
  icon: lifeAreas.icon,
  color: lifeAreas.color,
  sortOrder: lifeAreas.sortOrder,
};

/** Slug for names with no letters or digits (e.g. only emoji). */
export const LIFE_AREA_FALLBACK_SLUG = "area";

/**
 * Transaction-scoped lock for writes that read and then write across all areas: a new area's
 * slug and position, reordering, archiving and unarchiving. Serializes them, so a create never
 * picks a sort_order that a reorder is rewriting, and a reorder always checks its list against
 * the set of active areas it is about to write.
 */
export const LIFE_AREAS_LOCK = sql`select pg_advisory_xact_lock(hashtext('core_life_areas'))`;

/** Retries when another writer that does not take the lock (seed, imports) wins the slug race. */
const MAX_INSERT_ATTEMPTS = 3;
const SLUG_CONSTRAINT = "core_life_areas_slug_unique";

/** Postgres unique violation on the slug (Drizzle wraps the driver error in `cause`). */
export function isSlugConflict(error: unknown): boolean {
  // Bounded: a cyclic or absurdly deep `cause` chain must not loop forever.
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const { code, constraint, cause } = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (code === "23505" && constraint === SLUG_CONSTRAINT) return true;
    current = cause;
  }
  return false;
}

/** Areas in their order (sort_order, then creation). Archived ones only when asked. */
export async function selectLifeAreas(
  db: Database,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<LifeAreaSummary[]> {
  return db
    .select(SUMMARY)
    .from(lifeAreas)
    .where(includeArchived ? undefined : isNull(lifeAreas.archivedAt))
    .orderBy(asc(lifeAreas.sortOrder), asc(lifeAreas.createdAt));
}

/**
 * Creates an area at the end of the list (sort_order = max + 1, archived ones included) with a
 * unique slug from its name: "Música" → `musica`, or `musica-2` if taken (seeded slugs too,
 * so "Home" → `home-2`).
 */
export async function insertLifeArea(db: Database, input: LifeAreaInput): Promise<LifeAreaSummary> {
  const base = slugify(input.name, LIFE_AREA_FALLBACK_SLUG);
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(LIFE_AREAS_LOCK);
        // Only [a-z0-9-] in a slug, so `base` holds no LIKE wildcards.
        const taken = await tx
          .select({ slug: lifeAreas.slug })
          .from(lifeAreas)
          .where(or(eq(lifeAreas.slug, base), like(lifeAreas.slug, `${base}-%`)));
        const [{ next }] = await tx
          .select({
            next: sql<number>`coalesce(max(${lifeAreas.sortOrder}) + 1, 0)`.mapWith(Number),
          })
          .from(lifeAreas);
        const [area] = await tx
          .insert(lifeAreas)
          .values({
            name: input.name,
            icon: input.icon,
            color: input.color,
            slug: uniqueSlug(base, new Set(taken.map((row) => row.slug))),
            sortOrder: next,
          })
          .returning(SUMMARY);
        return area;
      });
    } catch (error) {
      if (attempt < MAX_INSERT_ATTEMPTS && isSlugConflict(error)) continue;
      throw error;
    }
  }
}

/** Archived areas, most recently archived first. */
export async function selectArchivedLifeAreas(db: Database): Promise<LifeAreaSummary[]> {
  return db
    .select(SUMMARY)
    .from(lifeAreas)
    .where(isNotNull(lifeAreas.archivedAt))
    .orderBy(desc(lifeAreas.archivedAt), desc(lifeAreas.createdAt));
}

/**
 * Renames and restyles an active area. The slug never changes (SPEC-core: it is the stable key
 * for seeds and imports), nor does its position. Archived areas are read-only until they are
 * unarchived. Returns null when there is no such area, "archived" when it is archived.
 */
export async function updateLifeAreaById(
  db: Database,
  { id, name, icon, color }: UpdateLifeAreaInput,
): Promise<LifeAreaSummary | "archived" | null> {
  const [area] = await db
    .update(lifeAreas)
    .set({ name, icon, color })
    .where(and(eq(lifeAreas.id, id), isNull(lifeAreas.archivedAt)))
    .returning(SUMMARY);
  if (area) return area;
  const [existing] = await db
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.id, id));
  return existing ? "archived" : null;
}

/**
 * Rewrites the order of every area in one transaction, under LIFE_AREAS_LOCK: `ids` (exactly
 * the active areas) first, then the archived ones as they were, so sort_order ends up 0…n-1.
 * Returns the active areas in their new order, or null (writing nothing) when `ids` is not
 * exactly the set of active areas: a stale list or a tampered request.
 */
export async function reorderLifeAreasByIds(
  db: Database,
  ids: readonly string[],
): Promise<LifeAreaSummary[] | null> {
  return db.transaction(async (tx) => {
    await tx.execute(LIFE_AREAS_LOCK);
    const rows = await tx
      .select({
        id: lifeAreas.id,
        sortOrder: lifeAreas.sortOrder,
        archivedAt: lifeAreas.archivedAt,
      })
      .from(lifeAreas)
      .orderBy(asc(lifeAreas.sortOrder), asc(lifeAreas.createdAt));
    const plan = planReorder(
      rows.map((row) => ({ id: row.id, archived: row.archivedAt !== null })),
      ids,
    );
    if (!plan) return null;
    // Only rows whose position changes (their updated_at moves too); one statement for all.
    const current = new Map(rows.map((row) => [row.id, row.sortOrder]));
    const changed = plan
      .map((id, index) => ({ id, index }))
      .filter(({ id, index }) => current.get(id) !== index);
    if (changed.length > 0) {
      const position = sql.join(
        changed.map(({ id, index }) => sql`when ${id}::uuid then ${index}::integer`),
        sql` `,
      );
      await tx
        .update(lifeAreas)
        .set({ sortOrder: sql`case ${lifeAreas.id} ${position} end` })
        .where(
          sql`${lifeAreas.id} in (${sql.join(
            changed.map(({ id }) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        );
    }
    return tx
      .select(SUMMARY)
      .from(lifeAreas)
      .where(isNull(lifeAreas.archivedAt))
      .orderBy(asc(lifeAreas.sortOrder), asc(lifeAreas.createdAt));
  });
}

/**
 * Archives an area (no physical delete in `core`). Its sort_order stays, so undoing puts it
 * back in place. Archiving an archived area changes nothing. Null when there is no such area.
 */
export async function archiveLifeAreaById(
  db: Database,
  id: string,
): Promise<LifeAreaSummary | null> {
  return db.transaction(async (tx) => {
    await tx.execute(LIFE_AREAS_LOCK);
    const [archived] = await tx
      .update(lifeAreas)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(lifeAreas.id, id), isNull(lifeAreas.archivedAt)))
      .returning(SUMMARY);
    if (archived) return archived;
    const [existing] = await tx.select(SUMMARY).from(lifeAreas).where(eq(lifeAreas.id, id));
    return existing ?? null;
  });
}

/**
 * Makes an archived area active again: at the end of the list (`end`, sort_order = max + 1 like
 * a new area) or where it was (`original`, to undo an archive). Unarchiving an active area
 * changes nothing. Null when there is no such area.
 */
export async function unarchiveLifeAreaById(
  db: Database,
  { id, position }: UnarchiveLifeAreaInput,
): Promise<LifeAreaSummary | null> {
  return db.transaction(async (tx) => {
    await tx.execute(LIFE_AREAS_LOCK);
    const [existing] = await tx
      .select({ ...SUMMARY, archivedAt: lifeAreas.archivedAt })
      .from(lifeAreas)
      .where(eq(lifeAreas.id, id));
    if (!existing) return null;
    const { archivedAt, ...summary } = existing;
    if (archivedAt === null) return summary;
    const [area] = await tx
      .update(lifeAreas)
      .set({
        archivedAt: null,
        ...(position === "end"
          ? {
              sortOrder: sql`(select coalesce(max(${lifeAreas.sortOrder}) + 1, 0) from ${lifeAreas})`,
            }
          : {}),
      })
      .where(eq(lifeAreas.id, id))
      .returning(SUMMARY);
    return area;
  });
}
