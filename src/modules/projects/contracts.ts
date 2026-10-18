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
// 3. getProjectProgress(projectId) (for `goals`): a project's progress (0–100) and status, the
//    same figure its page and the list show (milestones plus what the sources add).
//
// 5. getProjectsWeekReview(weekStart, now) (for `weekly-review`): the projects still in the works
//    with their progress, next action and what blocks them, and the milestones met in a week.
//
// 4. Project sections and next-action sources (T5 of `tasks`): a module adds a section to a
//    project's page (`registerProjectSection`) and gives the list's cards each project's next
//    action (`registerNextActionSource`). Same rules as the progress sources: idempotent by id,
//    registered by the composition root `src/lib/project-extensions.ts`
//    (`ensureProjectExtensions()`, imported by name), never imported by `projects`.
import "server-only";
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireOwner } from "@/lib/auth";
import { getDb, type Database } from "@/lib/db";
import { OWNER_TIME_ZONE } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { projectDependencies, projectMilestones, projects } from "./db/schema";
import { selectMilestoneCounts } from "./milestones";
import type { ProjectStatus } from "./project-constants";
import { milestoneProgress } from "./progress";
import { NON_BLOCKING_STATUSES, type ActiveBlocker } from "./dependency-input";
import {
  combineProgressCounts,
  createProgressRegistry,
  type MilestoneCounts,
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

export type { MilestoneCounts, ProgressCounts, ProgressSource } from "./progress-source";
export type { ProjectStatus } from "./project-constants";
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
 * The work counts of milestones, by milestone id, from the registered sources (a milestone is
 * complete when its work is all done: it has no checkbox of its own). Empty without a source that
 * answers by milestone. Callers check the owner first.
 */
export function contributedMilestones(
  milestoneIds: readonly string[],
): Promise<Map<string, MilestoneCounts>> {
  return registry.milestoneCountsFor(milestoneIds);
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

// ── Progress and options, for `goals` ─────────────────────────────────────────────────────────

/** A project's progress as a goal reads it: whole percent (0–100) and the project's state. */
export type ProjectProgressReading = { percent: number; status: ProjectStatus };

/** What a goal that follows a project shows: its name too. */
export type ProjectGoalReading = ProjectProgressReading & { name: string };

/**
 * The progress of the projects of `ids` that exist and aren't deleted, by id (deleted or missing
 * ones are absent). Same figure as the list and the detail: the milestones' counts plus what the
 * registered sources add (`contributedProgress`, after `ensureProgressSources()`), rounded to a
 * whole percent; 0 when there is nothing to show (no milestones, or Mantenimiento). Three
 * queries and one read per source, whatever the number of ids. Trusts its caller (see
 * getProjectProgress).
 */
export async function selectProjectsProgress(
  db: Database | Tx,
  ids: readonly string[],
): Promise<Map<string, ProjectGoalReading>> {
  const result = new Map<string, ProjectGoalReading>();
  if (ids.length === 0) return result;
  const wanted = [...new Set(ids)];
  const rows = await db
    .select({ id: projects.id, name: projects.name, status: projects.status })
    .from(projects)
    .where(and(inArray(projects.id, wanted), isNull(projects.deletedAt)));
  if (rows.length === 0) return result;
  // Dynamic: the composition root imports this file (for registerProgressSource), so a static
  // import would be a cycle.
  const { ensureProgressSources } = await import("@/lib/progress-sources");
  ensureProgressSources();
  const found = rows.map((row) => row.id);
  const [milestones, contributed] = await Promise.all([
    selectMilestoneCounts(db),
    contributedProgress(found),
  ]);
  for (const row of rows) {
    const progress = milestoneProgress(
      combineProgressCounts(milestones[row.id], contributed.get(row.id)),
      row.status,
    );
    result.set(row.id, {
      name: row.name,
      status: row.status,
      percent: progress ? Math.round(progress.ratio * 100) : 0,
    });
  }
  return result;
}

/**
 * For `goals`: a project's progress (whole percent) and status, or null when it doesn't exist or
 * is deleted. Checks the owner (redirects to /login without one).
 */
export async function getProjectProgress(
  projectId: string,
): Promise<ProjectProgressReading | null> {
  await requireOwner();
  const reading = (await selectProjectsProgress(getDb(), [projectId])).get(projectId);
  return reading ? { percent: reading.percent, status: reading.status } : null;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A project a goal can follow. */
export type ProjectOption = { id: string; name: string };

/** The states a goal can be put on: projects still in the works (Mantenimiento has no end). */
const GOAL_FOLLOWABLE_STATUSES = ["idea", "active", "paused"] as const;

/**
 * The projects a new goal can follow: not deleted, in Idea, Activo or Pausado (a finished,
 * canceled or maintenance project has no progress to follow), by name. Trusts its caller.
 */
export async function selectProjectOptions(db: Database): Promise<ProjectOption[]> {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(isNull(projects.deletedAt), inArray(projects.status, [...GOAL_FOLLOWABLE_STATUSES])))
    .orderBy(projects.name, projects.id);
}

/** For `goals`' form: the projects a goal can follow. Checks the owner. */
export async function getProjectOptions(): Promise<ProjectOption[]> {
  await requireOwner();
  return selectProjectOptions(getDb());
}

/**
 * The projects of `ids` that exist and aren't deleted, by id (any state: a goal keeps following
 * a project that finished). One query. Trusts its caller.
 */
export async function selectProjectAvailability(
  db: Database | Tx,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(inArray(projects.id, [...ids]), isNull(projects.deletedAt)));
  return new Set(rows.map((row) => row.id));
}

// ── The weekly review ───────────────────────────────────────────────────────────────────────

/** A project in the works as the review shows it. */
export type ProjectWeekReviewItem = {
  id: string;
  name: string;
  status: ProjectStatus;
  /** Whole percent, the figure the list and the page show (0 for Mantenimiento: no end). */
  progressPercent: number;
  /** Its next action (the title of the task `tasks` marks), or null. */
  nextAction: { id: string; title: string } | null;
  /** What blocks it, as a fact («Esperando a …»): empty when nothing does. */
  blockedBy: { id: string; name: string }[];
};

/** A milestone met within the week. */
export type MilestoneDoneInWeek = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  doneAt: Date;
};

export type ProjectsWeekReview = {
  /** The Monday of the week read. */
  weekStart: string;
  /**
   * The projects not finished, canceled or deleted (Idea, Activo, Pausado, Mantenimiento), the
   * active ones first, then by name. The screen decides how many it shows.
   */
  projects: ProjectWeekReviewItem[];
  /**
   * Milestones met within the week: live milestones whose `done_at` falls on one of its Lima days
   * (`project_milestones.done_at` is the instant it was checked; unchecking clears it), of any
   * project that isn't deleted, the latest first.
   */
  milestonesDone: MilestoneDoneInWeek[];
};

const WEEK_REVIEW_STATUS_ORDER = sql`case ${projects.status}
  when 'active' then 0 when 'paused' then 1 when 'maintenance' then 2 else 3 end`;

const DAY_MS = 86_400_000;
const addDays = (day: string, days: number) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

/**
 * The projects review of the week of `weekStart` (a Monday). Built on the same figures as the
 * list: `contributedProgress` through `selectProjectsProgress`, `projectNextActions` and
 * `selectActiveBlockers`; a fixed number of queries whatever the number of projects. Trusts its
 * caller (see getProjectsWeekReview).
 */
export async function selectProjectsWeekReview(
  db: Database,
  weekStart: string,
): Promise<ProjectsWeekReview> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || Number.isNaN(Date.parse(weekStart))) {
    throw new RangeError("weekStart must be a day as YYYY-MM-DD");
  }
  weekStart = addDays(weekStart, -((new Date(`${weekStart}T00:00:00Z`).getUTCDay() + 6) % 7));
  const sunday = addDays(weekStart, 6);
  const [rows, milestones] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name, status: projects.status })
      .from(projects)
      .where(
        and(isNull(projects.deletedAt), notInArray(projects.status, [...NON_BLOCKING_STATUSES])),
      )
      .orderBy(WEEK_REVIEW_STATUS_ORDER, asc(projects.name), asc(projects.id)),
    db
      .select({
        id: projectMilestones.id,
        title: projectMilestones.title,
        projectId: projects.id,
        projectName: projects.name,
        doneAt: projectMilestones.doneAt,
      })
      .from(projectMilestones)
      .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
      .where(
        and(
          isNull(projects.deletedAt),
          isNull(projectMilestones.deletedAt),
          isNotNull(projectMilestones.doneAt),
          sql`(${projectMilestones.doneAt} at time zone ${OWNER_TIME_ZONE})::date between ${weekStart}::date and ${sunday}::date`,
        ),
      )
      .orderBy(sql`${projectMilestones.doneAt} desc`, projectMilestones.id),
  ]);
  const milestonesDone = milestones.flatMap((row) =>
    row.doneAt ? [{ ...row, doneAt: row.doneAt }] : [],
  );
  if (rows.length === 0) return { weekStart, projects: [], milestonesDone };
  const ids = rows.map((row) => row.id);
  // Dynamic: the composition roots import this file, so a static import would be a cycle.
  const { ensureProjectExtensions } = await import("@/lib/project-extensions");
  ensureProjectExtensions();
  const progress = await selectProjectsProgress(db, ids);
  const [nextActions, blockers] = await Promise.all([
    projectNextActions(ids),
    selectActiveBlockers(db, ids),
  ]);
  const blockedBy = new Map<string, { id: string; name: string }[]>();
  for (const { projectId, id, name } of blockers) {
    const list = blockedBy.get(projectId);
    if (list) list.push({ id, name });
    else blockedBy.set(projectId, [{ id, name }]);
  }
  return {
    weekStart,
    projects: rows.map((row) => {
      const next = nextActions.get(row.id);
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        progressPercent: progress.get(row.id)?.percent ?? 0,
        nextAction: next ? { id: next.id, title: next.title } : null,
        blockedBy: blockedBy.get(row.id) ?? [],
      };
    }),
    milestonesDone,
  };
}

/**
 * For `weekly-review`: the projects still in the works with their progress, next action and
 * blockers, and the milestones met within the week of `weekStart` (any day of it; the result
 * names its Monday). Progress and blockers are read as they are now (`now` is accepted for the
 * contracts' shared shape and for a future week-end snapshot). Checks the owner.
 */
export async function getProjectsWeekReview(
  weekStart: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  now: Date = new Date(),
): Promise<ProjectsWeekReview> {
  await requireOwner();
  return selectProjectsWeekReview(getDb(), weekStart);
}
