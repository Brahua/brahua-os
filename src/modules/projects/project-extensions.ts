// Extension points of the project screens for other modules (T5 of `tasks`, SPEC-tasks
// "Contratos"). `tasks` depends on `projects`, never the other way: a module that has something
// to show on a project's page, or a next action for the list's cards, registers it here and the
// pages render what is registered. Pure (types and registry factories); the app's registries live
// in contracts.ts (server-only), and the composition root that registers the providers is
// src/lib/project-extensions.ts.
import type { ActionResult } from "@/lib/action-result";
import type { ProjectStatus } from "./project-constants";

// ── Sections of a project's page ────────────────────────────────────────────────────────────

/** What a section gets of the project whose page it is on. */
export type ProjectSectionContext = {
  project: { id: string; name: string; status: ProjectStatus };
  /** The project's live milestones, in their order (for grouping by milestone, for one). */
  milestones: readonly { id: string; title: string }[];
};

/**
 * A section another module adds to a project's page (between "Hitos" and "Bloqueado por").
 * `render` runs on the server after the page checked the owner and found the project: it may
 * read what it needs and returns the section (a Server Component tree; client parts inside it
 * read the page's queue and notices with `useScreenServices()` from `core`).
 */
export type ProjectSection = {
  /** Stable id of the provider (e.g. "tasks"). Registering the same id again replaces it. */
  id: string;
  render(context: ProjectSectionContext): React.ReactNode | Promise<React.ReactNode>;
};

export type ProjectSectionRegistry = {
  /** Adds `section`, or replaces the one with its id. Returns a function that removes it. */
  register(section: ProjectSection): () => void;
  size(): number;
  /** Every section rendered for the project, in registration order (in parallel). */
  render(context: ProjectSectionContext): Promise<{ id: string; node: React.ReactNode }[]>;
};

export function createProjectSectionRegistry(): ProjectSectionRegistry {
  const sections = new Map<string, ProjectSection>();
  return {
    register(section) {
      sections.set(section.id, section);
      return () => {
        if (sections.get(section.id) === section) sections.delete(section.id);
      };
    },
    size: () => sections.size,
    async render(context) {
      const all = [...sections.values()];
      const nodes = await Promise.all(all.map((section) => section.render(context)));
      return all.map((section, index) => ({ id: section.id, node: nodes[index] }));
    },
  };
}

// ── Next action of each project (the list's cards) ──────────────────────────────────────────

/** A project's next action as its card shows it ("Siguiente tarea"). */
export type NextAction = { id: string; title: string };

/**
 * A Server Action of the provider, called from the card with `{ id }` (the next action's id).
 * Reachable by any POST like every action: the provider checks the owner and validates.
 */
export type NextActionCall = (input: { id: string }) => Promise<ActionResult<unknown>>;

/**
 * The undo of completing it: `restored` says whether it is the next action again (not when
 * another task got the mark meanwhile: that one keeps it), and `warning` why it couldn't be (it
 * is pending again anyway), for a "Sin guardar" notice; null when nothing went wrong.
 */
export type NextActionUndoCall = (input: {
  id: string;
}) => Promise<ActionResult<{ restored: boolean; warning: string | null }>>;

/**
 * A module that knows each project's next action (`tasks`). `nextActionsFor` answers for the
 * given project ids in ONE read (ids without a next action are missing from the map) and runs on
 * the server after the page checked the owner. `complete` marks it done from the card and
 * `undoComplete` is the notice's "Deshacer" (pending again, and the next action again).
 */
export type NextActionSource = {
  id: string;
  nextActionsFor(projectIds: readonly string[]): Promise<ReadonlyMap<string, NextAction>>;
  complete: NextActionCall;
  undoComplete: NextActionUndoCall;
};

/** A project's next action with the calls of the source that gave it. */
export type ProjectNextAction = NextAction & {
  complete: NextActionCall;
  undoComplete: NextActionUndoCall;
};

export type NextActionRegistry = {
  /** Adds `source`, or replaces the one with its id. Returns a function that removes it. */
  register(source: NextActionSource): () => void;
  size(): number;
  /**
   * The next action of each project in `projectIds` that has one (one call per source, in
   * parallel; with two sources answering for a project, the first registered wins). No source,
   * or no ids, means no work at all.
   */
  nextActionsFor(projectIds: readonly string[]): Promise<Map<string, ProjectNextAction>>;
};

export function createNextActionRegistry(): NextActionRegistry {
  const sources = new Map<string, NextActionSource>();
  return {
    register(source) {
      sources.set(source.id, source);
      return () => {
        if (sources.get(source.id) === source) sources.delete(source.id);
      };
    },
    size: () => sources.size,
    async nextActionsFor(projectIds) {
      const result = new Map<string, ProjectNextAction>();
      if (sources.size === 0 || projectIds.length === 0) return result;
      const ids = [...new Set(projectIds)];
      const wanted = new Set(ids);
      const all = [...sources.values()];
      const answers = await Promise.all(all.map((source) => source.nextActionsFor(ids)));
      answers.forEach((answer, index) => {
        const { complete, undoComplete } = all[index];
        for (const [projectId, action] of answer) {
          if (!wanted.has(projectId) || result.has(projectId)) continue;
          result.set(projectId, { id: action.id, title: action.title, complete, undoComplete });
        }
      });
      return result;
    },
  };
}
