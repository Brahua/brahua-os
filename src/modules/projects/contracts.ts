// What `projects` offers other modules (P6, SPEC-projects "Contratos con otros módulos"). Two
// contracts, both server-only:
//
// 1. Progress sources (for `tasks`). `tasks` depends on `projects`, never the other way, so
//    `projects` can't read tasks: the provider registers a ProgressSource when its file is
//    imported, and the list and the detail add its counts to the milestones' with
//    contributedProgress(). Registration is idempotent (by source id). The composition root
//    `src/lib/progress-sources.ts` imports each source by name and registers it in
//    `ensureProgressSources()`, which the code that computes progress calls first (never a
//    side-effect-only import: the bundler drops them, see that file).
//
// 2. getProjectsTodaySummary(now) (for `today`): the projects due within a week or overdue and
//    the blocked ones, in two parallel queries.
//
// 3. Project sections and next-action sources (T5 of `tasks`): a module adds a section to a
//    project's page (`registerProjectSection`) and gives the list's cards each project's next
//    action (`registerNextActionSource`). Same rules as the progress sources: idempotent by id,
//    registered by the composition root `src/lib/project-extensions.ts`
//    (`ensureProjectExtensions()`, imported by name), never imported by `projects`.
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
import {
  createNextActionRegistry,
  createProjectSectionRegistry,
  type NextActionSource,
  type ProjectNextAction,
  type ProjectSection,
  type ProjectSectionContext,
} from "./project-extensions";
import { selectActiveBlockers } from "./projects";
import {
  buildTodaySummary,
  dueSoonLimit,
  TODAY_DUE_STATUSES,
  type ProjectTodayItem,
} from "./today-summary";

export type { ProgressCounts, ProgressSource } from "./progress-source";
export type { ProjectTodayItem } from "./today-summary";
export type {
  NextAction,
  NextActionCall,
  NextActionSource,
  NextActionUndoCall,
  ProjectNextAction,
  ProjectSection,
  ProjectSectionContext,
} from "./project-extensions";

// ── Progress sources ────────────────────────────────────────────────────────────────────────

/** The app's sources: one per server instance, filled by `ensureProgressSources()`. */
const registry = createProgressRegistry();

/**
 * Registers `source` (by its id: registering the same id again replaces it, so a module that is
 * evaluated twice, or hot-reloaded, never counts twice). Called by the composition root
 * (`ensureProgressSources()` in src/lib/progress-sources.ts). Returns a function that removes it
 * (for tests).
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

// ── Sections of a project's page and next actions (T5 of `tasks`) ─────────────────────────────

const sections = createProjectSectionRegistry();
const nextActions = createNextActionRegistry();

/**
 * Adds a section to every project's page (by id: registering it again replaces it). Called by
 * the composition root (`ensureProjectExtensions()`). Returns a function that removes it (tests).
 */
export function registerProjectSection(section: ProjectSection): () => void {
  return sections.register(section);
}

/** The registered sections rendered for one project (the page checked the owner first). */
export function renderProjectSections(
  context: ProjectSectionContext,
): Promise<{ id: string; node: React.ReactNode }[]> {
  return sections.render(context);
}

/**
 * Registers the module that knows each project's next action (by id). Called by the composition
 * root (`ensureProjectExtensions()`). Returns a function that removes it (tests).
 */
export function registerNextActionSource(source: NextActionSource): () => void {
  return nextActions.register(source);
}

/**
 * The next action of each of `projectIds` that has one, with the calls that complete it from the
 * card and undo that. One read per source for the whole list; none registered → empty, no work.
 * Callers check the owner first (the list does, with requireOwner()).
 */
export function projectNextActions(
  projectIds: readonly string[],
): Promise<Map<string, ProjectNextAction>> {
  return nextActions.nextActionsFor(projectIds);
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
