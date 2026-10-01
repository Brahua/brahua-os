// Projects data access (server only). These functions take the database and trust their input:
// callers check the owner and validate first (the actions through ownerAction(), the queries
// with requireOwner()).
import "server-only";
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Database } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { projects } from "./db/schema";
import type { ProjectPriority, ProjectStatus } from "./project-constants";
import type {
  CreateProjectInput,
  DeletedProject,
  ProjectDetail,
  ProjectAreaSummary,
  ProjectSummary,
  UpdateProjectDatesInput,
} from "./project-input";

const AREA = {
  id: lifeAreas.id,
  slug: lifeAreas.slug,
  name: lifeAreas.name,
  icon: lifeAreas.icon,
  color: lifeAreas.color,
};

const PROJECT = {
  id: projects.id,
  name: projects.name,
  objective: projects.objective,
  status: projects.status,
  priority: projects.priority,
  startDate: projects.startDate,
  dueDate: projects.dueDate,
  completedAt: projects.completedAt,
};

const SUMMARY = { ...PROJECT, area: AREA };

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Every project that isn't deleted, with its area (archived areas included). Unordered. */
export async function selectProjects(db: Database): Promise<ProjectSummary[]> {
  return db
    .select(SUMMARY)
    .from(projects)
    .innerJoin(lifeAreas, eq(projects.lifeAreaId, lifeAreas.id))
    .where(isNull(projects.deletedAt));
}

/** One project, unless it doesn't exist or is deleted. */
export async function selectProjectById(
  db: Database | Tx,
  id: string,
): Promise<ProjectSummary | null> {
  const [project] = await db
    .select(SUMMARY)
    .from(projects)
    .innerJoin(lifeAreas, eq(projects.lifeAreaId, lifeAreas.id))
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)));
  return project ?? null;
}

/**
 * What a project's page reads: the summary plus the detail-only columns. Kept apart from SUMMARY
 * so the list never loads them (P5 adds `notes: projects.notes` here, and to ProjectDetail).
 */
const DETAIL = { ...SUMMARY };

/** One project for its page, unless it doesn't exist or is deleted. */
export async function selectProjectDetailById(
  db: Database,
  id: string,
): Promise<ProjectDetail | null> {
  const [project] = await db
    .select(DETAIL)
    .from(projects)
    .innerJoin(lifeAreas, eq(projects.lifeAreaId, lifeAreas.id))
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)));
  return project ?? null;
}

/** How long after a delete the list still offers its "Deshacer" (`?deleted=<id>`). */
export const RECENT_DELETE_MINUTES = 10;

/**
 * A project deleted in the last minutes (for the list's undo notice), or null if it isn't
 * deleted or was deleted earlier: an old `?deleted=` link (history, a bookmark) offers nothing.
 */
export async function selectDeletedProjectById(
  db: Database,
  id: string,
): Promise<DeletedProject | null> {
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(
      and(
        eq(projects.id, id),
        isNotNull(projects.deletedAt),
        gt(projects.deletedAt, sql`now() - make_interval(mins => ${RECENT_DELETE_MINUTES})`),
      ),
    );
  return project ?? null;
}

/** An active area, locked FOR SHARE until the transaction ends (an archive waits for it). */
async function lockActiveArea(tx: Tx, lifeAreaId: string): Promise<ProjectAreaSummary | null> {
  const [area] = await tx
    .select(AREA)
    .from(lifeAreas)
    .where(and(eq(lifeAreas.id, lifeAreaId), isNull(lifeAreas.archivedAt)))
    .for("share");
  return area ?? null;
}

/**
 * Creates a project in an active life area. Null (writing nothing) when the area doesn't exist
 * or is archived. The area row is locked (FOR SHARE) until the insert commits, so an archive
 * running at the same time waits instead of leaving a new project in an area that was archived
 * after the check.
 */
export async function insertProject(
  db: Database,
  input: CreateProjectInput,
): Promise<ProjectSummary | null> {
  return db.transaction(async (tx) => {
    const area = await lockActiveArea(tx, input.lifeAreaId);
    if (!area) return null;
    const [project] = await tx
      .insert(projects)
      .values({ name: input.name, lifeAreaId: area.id, status: input.status })
      .returning(PROJECT);
    return { ...project, area };
  });
}

/** The columns the detail edits (never the area, `deleted_at` or the timestamps directly). */
type ProjectEdit = Pick<
  PgUpdateSetSource<typeof projects>,
  "name" | "objective" | "priority" | "status" | "completedAt" | "startDate" | "dueDate"
>;

/**
 * Writes fields of a project that isn't deleted and returns it as it is now. Null (writing
 * nothing) when it doesn't exist or is deleted.
 */
async function updateProject(
  db: Database,
  id: string,
  values: ProjectEdit,
): Promise<ProjectSummary | null> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(projects)
      .set(values)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .returning({ id: projects.id });
    if (updated.length === 0) return null;
    return selectProjectById(tx, id);
  });
}

export function setProjectName(db: Database, id: string, name: string) {
  return updateProject(db, id, { name });
}

export function setProjectObjective(db: Database, id: string, objective: string | null) {
  return updateProject(db, id, { objective });
}

export function setProjectPriority(db: Database, id: string, priority: ProjectPriority) {
  return updateProject(db, id, { priority });
}

/** Both dates together: the database CHECK compares them in the same row. */
export function setProjectDates(
  db: Database,
  id: string,
  { startDate, dueDate }: Pick<UpdateProjectDatesInput, "startDate" | "dueDate">,
) {
  return updateProject(db, id, { startDate, dueDate });
}

/**
 * Moves a project to `status` in one statement: Terminado stamps `completed_at` (keeping the
 * original date if it was already done), any other state clears it. The same rule as
 * `completedAtAfter` (project-status.ts), decided by the database so two tabs can't disagree.
 */
export function setProjectStatus(db: Database, id: string, status: ProjectStatus) {
  return updateProject(db, id, {
    status,
    completedAt: status === "done" ? sql`coalesce(${projects.completedAt}, now())` : null,
  });
}

/**
 * Moves a project to another area. Only active areas, locked FOR SHARE like creating; the
 * project's own area is a no-op even if it was archived since (a project keeps an archived area
 * until it is changed). `"areaUnavailable"` when the area is archived or doesn't exist; null
 * when the project doesn't exist or is deleted.
 */
export async function setProjectArea(
  db: Database,
  id: string,
  lifeAreaId: string,
): Promise<ProjectSummary | "areaUnavailable" | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ lifeAreaId: projects.lifeAreaId })
      .from(projects)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .for("update");
    if (!current) return null;
    if (current.lifeAreaId !== lifeAreaId) {
      const area = await lockActiveArea(tx, lifeAreaId);
      if (!area) return "areaUnavailable";
      await tx.update(projects).set({ lifeAreaId: area.id }).where(eq(projects.id, id));
    }
    return selectProjectById(tx, id);
  });
}

/**
 * Soft delete (SPEC-projects "Borrar"): stamps `deleted_at`, so the project leaves every view
 * but stays in `pnpm db:export`. Null when it doesn't exist or is already deleted.
 */
export async function softDeleteProject(db: Database, id: string): Promise<DeletedProject | null> {
  const [project] = await db
    .update(projects)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
    .returning({ id: projects.id, name: projects.name });
  return project ?? null;
}

/**
 * Undoes a soft delete. Restoring one that isn't deleted changes nothing (a second "Deshacer"
 * is not an error). Null only when the project doesn't exist at all.
 */
export async function restoreProjectById(db: Database, id: string): Promise<ProjectSummary | null> {
  return db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ deletedAt: null })
      .where(and(eq(projects.id, id), isNotNull(projects.deletedAt)));
    return selectProjectById(tx, id);
  });
}
