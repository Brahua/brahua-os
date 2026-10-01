// Projects data access (server only). These functions take the database and trust their input:
// callers check the owner and validate first (the actions through ownerAction(), the queries
// with requireOwner()).
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { projects } from "./db/schema";
import type { CreateProjectInput, ProjectSummary } from "./project-input";

const SUMMARY = {
  id: projects.id,
  name: projects.name,
  objective: projects.objective,
  status: projects.status,
  priority: projects.priority,
  dueDate: projects.dueDate,
  area: {
    id: lifeAreas.id,
    slug: lifeAreas.slug,
    name: lifeAreas.name,
    icon: lifeAreas.icon,
    color: lifeAreas.color,
  },
};

/** Every project that isn't deleted, with its area (archived areas included). Unordered. */
export async function selectProjects(db: Database): Promise<ProjectSummary[]> {
  return db
    .select(SUMMARY)
    .from(projects)
    .innerJoin(lifeAreas, eq(projects.lifeAreaId, lifeAreas.id))
    .where(isNull(projects.deletedAt));
}

/** One project, unless it doesn't exist or is deleted. */
export async function selectProjectById(db: Database, id: string): Promise<ProjectSummary | null> {
  const [project] = await db
    .select(SUMMARY)
    .from(projects)
    .innerJoin(lifeAreas, eq(projects.lifeAreaId, lifeAreas.id))
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)));
  return project ?? null;
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
    const [area] = await tx
      .select(SUMMARY.area)
      .from(lifeAreas)
      .where(and(eq(lifeAreas.id, input.lifeAreaId), isNull(lifeAreas.archivedAt)))
      .for("share");
    if (!area) return null;
    const [project] = await tx
      .insert(projects)
      .values({ name: input.name, lifeAreaId: area.id, status: input.status })
      .returning({
        id: projects.id,
        name: projects.name,
        objective: projects.objective,
        status: projects.status,
        priority: projects.priority,
        dueDate: projects.dueDate,
      });
    return { ...project, area };
  });
}
