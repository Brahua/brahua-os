// Progress contributed by other modules (P6, SPEC-projects "Contratos con otros módulos").
// `tasks` depends on `projects`, so `projects` never reads tasks: a module that knows how much
// of a project is done registers a ProgressSource, and the progress of a project adds its counts
// to the milestones'. Pure and client-safe (types, the sum and a registry factory); the app's
// registry and the reads live in contracts.ts (server-only).

/** Done and total units of work of one project (milestones, tasks, …). */
export type ProgressCounts = { done: number; total: number };

/**
 * A module that contributes to the progress of projects. `countsFor` answers for the given
 * project ids only (ids it has nothing for are simply missing from the map) and runs on the
 * server, after the page checked the owner: it may query the database directly.
 */
export type ProgressSource = {
  /** Stable id of the provider (e.g. "tasks"). Registering the same id again replaces it. */
  id: string;
  countsFor(projectIds: readonly string[]): Promise<ReadonlyMap<string, ProgressCounts>>;
};

/** Whole, non-negative counts with done ≤ total, so one bad pair can't distort the sum. */
function clean(counts: ProgressCounts): ProgressCounts {
  const total = Number.isFinite(counts.total) ? Math.max(0, Math.floor(counts.total)) : 0;
  const done = Number.isFinite(counts.done) ? Math.max(0, Math.floor(counts.done)) : 0;
  return { done: Math.min(done, total), total };
}

/**
 * Combines counts of the same project by adding them: the milestones' and every source's
 * (SPEC-projects: "con tareas, el avance combina hitos y tareas"). Each unit weighs the same, so
 * 1 of 2 milestones plus 3 of 8 tasks is 4 of 10. Undefined parts are skipped; nothing at all
 * (or only zeros) gives `undefined`, so a project with nothing to count still shows no progress.
 */
export function combineProgressCounts(
  ...parts: ReadonlyArray<ProgressCounts | null | undefined>
): ProgressCounts | undefined {
  let done = 0;
  let total = 0;
  for (const part of parts) {
    if (!part) continue;
    const counts = clean(part);
    done += counts.done;
    total += counts.total;
  }
  return total === 0 ? undefined : { done, total };
}

/** A set of sources: what contracts.ts keeps for the whole app (and tests build on their own). */
export type ProgressRegistry = {
  /** Adds `source`, or replaces the one with its id. Returns a function that removes it. */
  register(source: ProgressSource): () => void;
  /** How many sources are registered. */
  size(): number;
  /**
   * The sum of every source's counts for `projectIds`, by project id (only ids some source
   * counted). Sources run in parallel; none registered (or no ids) means no work at all.
   */
  countsFor(projectIds: readonly string[]): Promise<Map<string, ProgressCounts>>;
};

export function createProgressRegistry(): ProgressRegistry {
  const sources = new Map<string, ProgressSource>();
  return {
    register(source) {
      sources.set(source.id, source);
      return () => {
        // Only if it wasn't replaced since: removing must never drop a newer registration.
        if (sources.get(source.id) === source) sources.delete(source.id);
      };
    },
    size: () => sources.size,
    async countsFor(projectIds) {
      const result = new Map<string, ProgressCounts>();
      if (sources.size === 0 || projectIds.length === 0) return result;
      const ids = [...new Set(projectIds)];
      const wanted = new Set(ids);
      const answers = await Promise.all([...sources.values()].map((s) => s.countsFor(ids)));
      for (const answer of answers) {
        for (const [projectId, counts] of answer) {
          if (!wanted.has(projectId)) continue;
          const sum = combineProgressCounts(result.get(projectId), counts);
          if (sum) result.set(projectId, sum);
        }
      }
      return result;
    },
  };
}
