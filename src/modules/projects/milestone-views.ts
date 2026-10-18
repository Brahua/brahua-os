// A project's milestones as the screens show them (hitos-agrupan-tareas; server only): each one with
// the state derived from its tasks. A milestone has no checkbox of its own: it is complete when all
// its tasks are done (`milestone-state.ts`), so the state is computed on every read from what the
// registered progress sources count by milestone (`tasks`), never stored. Callers check the owner.
import "server-only";
import type { Database } from "@/lib/db";
import { contributedMilestones } from "./contracts";
import type { ProjectMilestoneItem } from "./milestone-input";
import { milestoneState } from "./milestone-state";
import { selectMilestones } from "./milestones";
import type { MilestoneCounts, ProgressCounts } from "./progress-source";

/** Registers the sources once (dynamic: the composition root imports contracts.ts). */
async function ensureSources() {
  const { ensureProgressSources } = await import("@/lib/progress-sources");
  ensureProgressSources();
}

/** The items with their derived state: done when complete, and their tasks' counts. */
export function withTaskState(
  items: readonly ProjectMilestoneItem[],
  counts: ReadonlyMap<string, MilestoneCounts>,
): ProjectMilestoneItem[] {
  return items.map((item) => {
    const state = milestoneState(counts.get(item.id));
    return {
      ...item,
      // Complete always has the instant of its last task; the epoch is only a guard for a bad row.
      doneAt: state.status === "complete" ? (state.completedAt ?? new Date(0)) : null,
      tasks: { done: state.done, total: state.total },
    };
  });
}

/** The project's live milestones in order, with their state. */
export async function selectMilestoneViews(
  db: Database,
  projectId: string,
): Promise<ProjectMilestoneItem[]> {
  await ensureSources();
  const items = await selectMilestones(db, projectId);
  return withTaskState(items, await contributedMilestones(items.map((item) => item.id)));
}

/**
 * How many of the project's milestones are complete, of how many (what "Cerrar proyecto" counts as
 * open phases). Zeros without milestones.
 */
export async function selectPhaseCounts(db: Database, projectId: string): Promise<ProgressCounts> {
  const views = await selectMilestoneViews(db, projectId);
  return { done: views.filter((view) => view.doneAt !== null).length, total: views.length };
}
