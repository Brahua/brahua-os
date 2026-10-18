// The state of a milestone (hitos-agrupan-tareas): a milestone has no checkbox of its own, it is a
// phase of the project that groups tasks and is complete when all of them are done. Pure and
// client-safe: the state is derived on every read from the counts of the milestone's live tasks
// (never stored), so completing, undoing, deleting or restoring a task is all it takes.
import type { MilestoneCounts } from "@/modules/projects/contracts";

/** Where a milestone stands. */
export type MilestoneStatus =
  /** At least one task and all of them done. */
  | "complete"
  /** At least one task, some still open (some may be done). */
  | "inProgress"
  /** No tasks yet: a planned phase with nothing to do in it (never counts as done). */
  | "empty";

export type MilestoneState = {
  status: MilestoneStatus;
  done: number;
  total: number;
  /** `done / total` between 0 and 1; 0 when empty. */
  ratio: number;
  /** When the last task was done (only meaningful while complete): the phase's closing instant. */
  completedAt: Date | null;
};

/** The state of a milestone from what its work counted (no counts: no tasks). */
export function milestoneState(counts: MilestoneCounts | null | undefined): MilestoneState {
  const total = Math.max(0, Math.floor(counts?.total ?? 0));
  const done = Math.min(total, Math.max(0, Math.floor(counts?.done ?? 0)));
  if (total === 0) return { status: "empty", done: 0, total: 0, ratio: 0, completedAt: null };
  const complete = done === total;
  return {
    status: complete ? "complete" : "inProgress",
    done,
    total,
    ratio: done / total,
    completedAt: complete ? (counts?.lastDoneAt ?? null) : null,
  };
}

/** Whether `completedAt` falls inside [from, to) — the week a phase was closed in. */
export function completedWithin(state: MilestoneState, from: Date, to: Date): boolean {
  return (
    state.status === "complete" &&
    state.completedAt !== null &&
    state.completedAt >= from &&
    state.completedAt < to
  );
}

/**
 * Whether completing or undoing a task changed its milestone's status (`before` and `after` are
 * the milestone's states around the change): the notice «Hito completo» says it once, and undoing
 * reopens it. Null when nothing changed.
 */
export function phaseChange(before: MilestoneState, after: MilestoneState): "closed" | "reopened" | null {
  if (before.status !== "complete" && after.status === "complete") return "closed";
  if (before.status === "complete" && after.status !== "complete") return "reopened";
  return null;
}
