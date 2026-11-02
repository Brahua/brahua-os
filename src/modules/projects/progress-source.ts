// Progress contributed by other modules (P6, SPEC-projects "Contratos con otros módulos").
// `tasks` depends on `projects`, so `projects` never reads tasks: a module that knows how much
// of a project is done registers a ProgressSource, and the progress of a project adds its counts
// to the milestones'. Pure and client-safe (types, the sum and a registry factory); the app's
// registry and the reads live in contracts.ts (server-only).

/**
 * Done and total units of work of one project (tasks, learning tracks, …). `total` is a whole
 * number of units; `done` may be fractional (SPEC-learning L3: a track is one unit and contributes
 * its share of steps done), 0 ≤ done ≤ total. A milestone's counts stay whole (tasks only).
 */
export type ProgressCounts = { done: number; total: number };

/**
 * A project's counts summed across the sources (`contributedProgress`), with `units`: what the
 * units are, as the progress label names them («tareas», «tareas y frentes»). Present only when
 * every source that counted something for the project declares its `unit` (registration order,
 * once each); missing means the label can't tell, so it names none.
 */
export type ContributedCounts = ProgressCounts & { units?: readonly string[] };

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
  /**
   * What one unit of this source is, in the plural, as the progress label says it (UI copy, e.g.
   * «tareas», «frentes»). A source without it makes the label name no units for that project.
   */
  unit?: string;
  countsFor(projectIds: readonly string[]): Promise<ReadonlyMap<string, ProgressCounts>>;
  /**
   * The same by milestone: only for the milestone ids given; ids it has nothing for are missing.
   * Optional: a source that doesn't group its work by milestone just doesn't have it.
   */
  milestoneCountsFor?(
    milestoneIds: readonly string[],
  ): Promise<ReadonlyMap<string, MilestoneCounts>>;
};

/**
 * A whole, non-negative total and a non-negative `done` ≤ total (fractional allowed: a learning
 * track at 50 % is 0.5), so one bad pair can't distort the sum.
 */
function clean(counts: ProgressCounts): ProgressCounts {
  const total = Number.isFinite(counts.total) ? Math.max(0, Math.floor(counts.total)) : 0;
  const done = Number.isFinite(counts.done) ? Math.max(0, counts.done) : 0;
  return { done: Math.min(done, total), total };
}

/**
 * The whole units done of a (possibly fractional) `done`, rounded down: every «N de M» says it
 * (1.5 of 3 is «1 de 3»). A hair under a whole number from adding fractions still counts as it.
 */
export function wholeDone(done: number): number {
  return Math.floor(done + 1e-9);
}

/**
 * Combines counts of the same project by adding them: the milestones' and every source's
 * (SPEC-projects: "con tareas, el avance combina hitos y tareas"). Each unit weighs the same, so
 * 1 of 2 milestones plus 3 of 8 tasks is 4 of 10, and 1 of 2 tasks plus a track at 50 % is 1.5 of
 * 3 (`done` stays exact; the texts round it down). Undefined parts are skipped; nothing at all
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
  countsFor(projectIds: readonly string[]): Promise<Map<string, ContributedCounts>>;
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
      const result = new Map<string, ContributedCounts>();
      if (sources.size === 0 || projectIds.length === 0) return result;
      const ids = [...new Set(projectIds)];
      const wanted = new Set(ids);
      const registered = [...sources.values()];
      const answers = await Promise.all(registered.map((s) => s.countsFor(ids)));
      // Per project: the units of the sources that counted something, or null once one of them
      // doesn't say what its units are (the label then names none).
      const units = new Map<string, string[] | null>();
      answers.forEach((answer, index) => {
        const unit = registered[index]!.unit;
        for (const [projectId, counts] of answer) {
          if (!wanted.has(projectId)) continue;
          const sum = combineProgressCounts(result.get(projectId), counts);
          if (!sum) continue;
          result.set(projectId, sum);
          if (!combineProgressCounts(counts)) continue; // counted nothing: says nothing either
          const known = units.has(projectId) ? units.get(projectId)! : [];
          if (known === null) continue;
          if (unit === undefined) units.set(projectId, null);
          else units.set(projectId, known.includes(unit) ? known : [...known, unit]);
        }
      });
      for (const [projectId, sum] of result) {
        const named = units.get(projectId);
        if (named && named.length > 0) result.set(projectId, { ...sum, units: named });
      }
      return result;
    },
  };
}
