// Progress contributed by other modules (P6, SPEC-projects "Contratos con otros módulos").
// `tasks` depends on `projects`, so `projects` never reads tasks: a module that knows how much
// of a project is done registers a ProgressSource, and the progress of a project adds its counts
// to the milestones'. Pure and client-safe (types, the sum and a registry factory); the app's
// registry and the reads live in contracts.ts (server-only).

/** Done and total units of work of one project (milestones, tasks, …). */
export type ProgressCounts = { done: number; total: number };

/**
 * What a source knows of one milestone's work (hitos-agrupan-tareas): how many units are done of
 * how many, and when the last one was done. A milestone has no checkbox of its own: it is complete
 * when everything that belongs to it is done (see `milestone-state.ts`).
 */
export type MilestoneCounts = ProgressCounts & { lastDoneAt: Date | null };

/**
 * A module that contributes to the progress of projects. `countsFor` answers for the given
 * project ids only (ids it has nothing for are simply missing from the map) and runs on the
 * server, after the page checked the owner: it may query the database directly.
 */
export type ProgressSource = {
  /** Stable id of the provider (e.g. "tasks"). Registering the same id again replaces it. */
  id: string;
  countsFor(projectIds: readonly string[]): Promise<ReadonlyMap<string, ProgressCounts>>;
  /**
   * The same by milestone: only for the milestone ids given; ids it has nothing for are missing.
   * Optional: a source that doesn't group its work by milestone just doesn't have it.
   */
  milestoneCountsFor?(
    milestoneIds: readonly string[],
  ): Promise<ReadonlyMap<string, MilestoneCounts>>;
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
   * The counts of every milestone in `milestoneIds` that some source has work for (sources that
   * answer for the same milestone add up; the latest `lastDoneAt` wins). Nothing registered, or no
   * source with the method, means no work at all.
   */
  milestoneCountsFor(milestoneIds: readonly string[]): Promise<Map<string, MilestoneCounts>>;
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
    async milestoneCountsFor(milestoneIds) {
      const result = new Map<string, MilestoneCounts>();
      const ids = [...new Set(milestoneIds)];
      const withMethod = [...sources.values()].filter((source) => source.milestoneCountsFor);
      if (withMethod.length === 0 || ids.length === 0) return result;
      const wanted = new Set(ids);
      const answers = await Promise.all(
        withMethod.map((source) => source.milestoneCountsFor!(ids)),
      );
      for (const answer of answers) {
        for (const [milestoneId, counts] of answer) {
          if (!wanted.has(milestoneId)) continue;
          const sum = combineProgressCounts(result.get(milestoneId), counts);
          if (!sum) continue;
          const previous = result.get(milestoneId)?.lastDoneAt ?? null;
          const latest =
            previous && counts.lastDoneAt
              ? previous > counts.lastDoneAt
                ? previous
                : counts.lastDoneAt
              : (previous ?? counts.lastDoneAt);
          result.set(milestoneId, { ...sum, lastDoneAt: latest });
        }
      }
      return result;
    },
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
