// Closing a project (Checkpoint final de projects): Terminado and Cancelado are a separate,
// confirmed action ("Cerrar proyecto"), not options of the state picker. Pure and client-safe:
// the detail and the server action share these rules.
import { combineProgressCounts, type ProgressCounts } from "./progress-source";
import type { ProjectStatus } from "./project-constants";

/** The states that close a project: out of the main view, into "Historial". */
export const CLOSED_STATUSES = ["done", "canceled"] as const satisfies readonly ProjectStatus[];
export type ClosedStatus = (typeof CLOSED_STATUSES)[number];

/** The states the picker offers (the same four a project can be created in). */
export const OPEN_STATUSES = [
  "idea",
  "active",
  "paused",
  "maintenance",
] as const satisfies readonly ProjectStatus[];

/**
 * Where "Reabrir" takes a closed project. Always Activo: the state before closing isn't stored
 * (keeping it would need a new column) and reopening means working on it again; any other state
 * is one tap away in the picker afterwards.
 */
export const REOPEN_STATUS = "active" satisfies ProjectStatus;

export function isClosed(status: ProjectStatus): status is ClosedStatus {
  return (CLOSED_STATUSES as readonly ProjectStatus[]).includes(status);
}

/**
 * What is still open in a project: its milestones not done and, through the progress sources
 * (P6 contract; `tasks` once it exists), the units they count as not done.
 */
export type OpenWork = { milestones: number; tasks: number };

/** Open work from done/total counts (each pair cleaned like the progress: whole, done ≤ total). */
export function openWork(
  milestones?: ProgressCounts | null,
  contributed?: ProgressCounts | null,
): OpenWork {
  const open = (counts?: ProgressCounts | null) => {
    const clean = combineProgressCounts(counts);
    return clean ? clean.total - clean.done : 0;
  };
  return { milestones: open(milestones), tasks: open(contributed) };
}

export function hasOpenWork({ milestones, tasks }: OpenWork): boolean {
  return milestones + tasks > 0;
}
