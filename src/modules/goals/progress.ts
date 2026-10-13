// Progress of a goal by source (SPEC-goals "Decisiones": Fuente de avance). Pure and client-safe:
// what each source reads (the sum of a manual goal's entries today) comes in as a value, so the
// rules are tested without a database and `pace.ts` can read the result as it is.
//
// G2 slot: `habit` (days done in the period, from `getHabitDoneDays`) and `project` (the
// project's percentage, from `getProjectProgress`) plug in at the two marked branches below by
// adding their reading to `SourceReading`; nothing else changes (the rows already handle the
// "unavailable" case).
import type { GoalSourceKind } from "./goal-constants";

/** What a source read for a goal. G1 only has the manual sum. */
export type SourceReading = { sourceKind: "manual"; sum: number };

export type GoalProgress =
  | {
      kind: "ok";
      /** What counts toward the target (never below 0: a correction can't make it negative). */
      value: number;
      target: number;
      /** `value / target`, between 0 and 1. */
      ratio: number;
      reached: boolean;
    }
  /** The source's reading isn't wired yet (habit and project goals arrive in G2). */
  | { kind: "unavailable"; reason: "source-not-available" };

/** The progress of a goal of `sourceKind` toward `target`, from what its source read. */
export function progressOf(
  goal: { sourceKind: GoalSourceKind; target: number },
  reading: SourceReading | null,
): GoalProgress {
  if (goal.sourceKind === "manual" && reading?.sourceKind === "manual") {
    return measured(reading.sum, goal.target);
  }
  // G2 slot: `habit` → measured(doneDays, target); `project` → measured(percent, 100).
  return { kind: "unavailable", reason: "source-not-available" };
}

function measured(rawValue: number, target: number): GoalProgress {
  const value = Math.max(0, rawValue);
  return {
    kind: "ok",
    value,
    target,
    ratio: target > 0 ? Math.min(value / target, 1) : 0,
    reached: value >= target,
  };
}

/** What a change of the progress does to a goal's status. */
export type AchievementChange = "achieve" | "reopen" | null;

/**
 * Whether a change of the progress (an entry, its undo, a new target) achieves or reopens a goal
 * (SPEC-goals "Cierre"). An active goal that reaches its target is achieved; an achieved one
 * that was at its target and drops below it (a correction, an undo, a higher target) is
 * reopened. One marked achieved by hand below its target (`wasReached` false) is left alone: only
 * "Reabrir" changes it. A goal already in the state asked for changes nothing, so doing it twice
 * (two entries at once) is the same as doing it once.
 */
export function achievementChange(args: {
  status: "active" | "achieved" | "archived";
  wasReached: boolean;
  nowReached: boolean;
}): AchievementChange {
  if (args.status === "active" && args.nowReached) return "achieve";
  if (args.status === "achieved" && args.wasReached && !args.nowReached) return "reopen";
  return null;
}
