// What `projects` offers other modules (P6, SPEC-projects "Contratos con otros módulos"). Two
// contracts, both server-only:
//
// 1. Progress sources (for `tasks`). `tasks` depends on `projects`, never the other way, so
//    `projects` can't read tasks: the provider registers a ProgressSource when its file is
//    imported, and the list and the detail add its counts to the milestones' with
//    contributedProgress(). Registration is idempotent (by source id) and happens again on every
//    cold start, because it runs at import time. For a source to be loaded where progress is
//    computed, its file must be imported for its side effect from `src/lib/progress-sources.ts`,
//    which the projects pages import (see that file).
//
// 2. getProjectsTodaySummary(now) (for `today`): the projects due within a week or overdue and
//    the blocked ones, in two parallel queries.
import "server-only";
import { and, eq, exists, inArray, isNull, lte, notInArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import { lifeAreas } from "@/modules/core/db/schema";
import { projectDependencies, projects } from "./db/schema";
import { NON_BLOCKING_STATUSES, type ActiveBlocker } from "./dependency-input";
import {
  createProgressRegistry,
  type ProgressCounts,
  type ProgressSource,
} from "./progress-source";
import { selectActiveBlockers } from "./projects";
import {
  buildTodaySummary,
  dueSoonLimit,
  TODAY_DUE_STATUSES,
  type ProjectTodayItem,
} from "./today-summary";

export type { ProgressCounts, ProgressSource } from "./progress-source";
export type { ProjectTodayItem } from "./today-summary";

// ── Progress sources ────────────────────────────────────────────────────────────────────────

/** The app's sources: one per server instance, filled when the providers' files are imported. */
const registry = createProgressRegistry();

/**
 * Registers `source` (by its id: registering the same id again replaces it, so a module that is
 * evaluated twice, or hot-reloaded, never counts twice). Call it at the top level of the
 * provider's file. Returns a function that removes it (for tests).
 */
export function registerProgressSource(source: ProgressSource): () => void {
  return registry.register(source);
}

/**
 * The counts the registered sources contribute, by project id, to add to each project's
 * milestones with combineProgressCounts(). With no source registered it returns an empty map
 * without awaiting anything. Callers check the owner first (the pages do, with requireOwner()).
 */
export function contributedProgress(
  projectIds: readonly string[],
): Promise<Map<string, ProgressCounts>> {
  return registry.countsFor(projectIds);
}

// ── Today ───────────────────────────────────────────────────────────────────────────────────

const blocker = alias(projects, "today_blocker");

/** A blocker that still blocks the outer project (P4's rule, as in selectActiveBlockers). */
const hasActiveBlocker = (db: Database) =>
  exists(
    db
      .select({ one: projectDependencies.projectId })
      .from(projectDependencies)
      .innerJoin(blocker, eq(blocker.id, projectDependencies.blockedById))
      .where(
        and(
          eq(projectDependencies.projectId, projects.id),
          isNull(blocker.deletedAt),
          notInArray(blocker.status, [...NON_BLOCKING_STATUSES]),
        ),
      ),
  );

/**
 * The summary's rows and blockers, in two parallel queries: the candidates (not deleted; in Idea,
 * Activo or Pausado due by Lima's today + 7, or not done nor canceled with a blocker that still
 * blocks) and every active blocker. Trusts its caller (see getProjectsTodaySummary).
 */
export async function selectProjectsTodaySummary(
  db: Database,
  now: Date,
): Promise<ProjectTodayItem[]> {
  const [rows, blockers] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        area: {
          id: lifeAreas.id,
          slug: lifeAreas.slug,
          name: lifeAreas.name,
          icon: lifeAreas.icon,
          color: lifeAreas.color,
        },
        status: projects.status,
        priority: projects.priority,
        dueDate: projects.dueDate,
      })
      .from(projects)
      .innerJoin(lifeAreas, eq(projects.lifeAreaId, lifeAreas.id))
      .where(
        and(
          isNull(projects.deletedAt),
          or(
            and(
              inArray(projects.status, [...TODAY_DUE_STATUSES]),
              lte(projects.dueDate, dueSoonLimit(now)),
            ),
            and(notInArray(projects.status, [...NON_BLOCKING_STATUSES]), hasActiveBlocker(db)),
          ),
        ),
      ),
    selectActiveBlockers(db),
  ]);
  const byProject = new Map<string, ActiveBlocker[]>();
  for (const { projectId, id, name } of blockers) {
    const list = byProject.get(projectId);
    if (list) list.push({ id, name });
    else byProject.set(projectId, [{ id, name }]);
  }
  return buildTodaySummary(rows, byProject, now);
}

/**
 * For `today`: the projects due within 7 days or overdue (Idea, Activo, Pausado; by Lima's day)
 * and the blocked ones (any state but Terminado and Cancelado), overdue first, then due soonest,
 * then priority. Checks the owner like the other queries (redirects to /login without one).
 */
export async function getProjectsTodaySummary(now: Date): Promise<ProjectTodayItem[]> {
  await requireOwner();
  return selectProjectsTodaySummary(getDb(), now);
}
