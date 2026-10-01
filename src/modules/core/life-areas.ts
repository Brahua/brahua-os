// Life areas data access (server only). These functions take the database and trust their
// input: callers check the owner and validate first (the actions through ownerAction(), the
// queries with requireOwner()).
import "server-only";
import { asc, eq, isNull, like, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { slugify, uniqueSlug } from "@/lib/text";
import { lifeAreas } from "./db/schema";
import type { LifeAreaInput, LifeAreaSummary, UpdateLifeAreaInput } from "./life-area-input";

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
 * Transaction-scoped lock for writes that read and then write across all areas (a new area's
 * slug and position; reordering in C6). Serializes them, so two creates never pick the same
 * sort_order or slug.
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

/**
 * Renames and restyles an area. The slug never changes (SPEC-core: it is the stable key for
 * seeds and imports), nor does its position. Returns null when there is no such area.
 */
export async function updateLifeAreaById(
  db: Database,
  { id, name, icon, color }: UpdateLifeAreaInput,
): Promise<LifeAreaSummary | null> {
  const [area] = await db
    .update(lifeAreas)
    .set({ name, icon, color })
    .where(eq(lifeAreas.id, id))
    .returning(SUMMARY);
  return area ?? null;
}
