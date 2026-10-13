// What a goal row says, from its data and the day: "5 de 12 libros" and the pace line. Pure and
// client-safe (the rows and the detail share it, and the tests read it without rendering).
import { formatDateKey } from "@/lib/time";
// URL helpers only (client-safe): the one thing of `habits` and `projects` besides their contracts
// that `goals` may import (see eslint.config.mjs).
import { habitPath } from "@/modules/habits/routes";
import { projectPath } from "@/modules/projects/routes";
import type { GoalItem } from "./goal-input";
import { GOALS_COPY } from "./goals-copy";
import { paceOf, periodBounds, periodOf, periodPhase, type Pace } from "./pace";
import { progressOf, type SourceReading } from "./progress";

/** The habit or project a goal follows, to name and link in its row. */
export type GoalSourceLink = { kind: "habit" | "project"; name: string; href: string };

export type GoalReading =
  | {
      kind: "ok";
      value: number;
      target: number;
      /** 0–1, for the bar. */
      ratio: number;
      /** "5 de 12 libros", "34 de 40 días", "62 %". */
      count: string;
      /** The habit or project it follows (a link next to the count), or null. */
      source: GoalSourceLink | null;
      /** The pace line ("Vas 1 por delante de tu ritmo"), or null when there is nothing to say. */
      line: string | null;
      pace: Pace | null;
    }
  | { kind: "unavailable"; line: string };

/** The unit shown after the numbers: a habit goal counts "días", a project's is "%". */
export function unitOf(goal: Pick<GoalItem, "sourceKind" | "unit">): string {
  if (goal.sourceKind === "habit") return "días";
  if (goal.sourceKind === "project") return "%";
  return goal.unit ?? "";
}

/** What the goal's source read, in the shape `progressOf` takes (null: it can't be read). */
export function sourceReadingOf(goal: GoalItem): SourceReading | null {
  const { source } = goal;
  if (goal.sourceKind === "manual") return { sourceKind: "manual", sum: goal.sum };
  if (goal.sourceKind === "habit" && source?.kind === "habit") {
    return { sourceKind: "habit", done: source.done };
  }
  if (goal.sourceKind === "project" && source?.kind === "project") {
    return { sourceKind: "project", percent: source.percent, finished: source.finished };
  }
  return null;
}

/** The link to the habit or project a goal follows, or null (manual, or the source is gone). */
export function sourceLinkOf(goal: GoalItem): GoalSourceLink | null {
  if (goal.sourceKind === "habit" && goal.habitId && goal.source?.kind === "habit") {
    return { kind: "habit", name: goal.source.name, href: habitPath(goal.habitId) };
  }
  if (goal.sourceKind === "project" && goal.projectId && goal.source?.kind === "project") {
    return { kind: "project", name: goal.source.name, href: projectPath(goal.projectId) };
  }
  return null;
}

/** Whether a habit or project goal's source reaches its target now (a manual goal: never). */
export function sourceReached(goal: GoalItem): boolean {
  if (!goal.source) return false;
  return goal.source.kind === "habit" ? goal.source.done >= goal.target : goal.source.finished;
}

/** How the goal reads on `today` (a Lima day). */
export function readGoal(goal: GoalItem, today: string): GoalReading {
  const progress = progressOf(goal, sourceReadingOf(goal));
  if (progress.kind === "unavailable") {
    return { kind: "unavailable", line: GOALS_COPY.sourceUnavailable };
  }
  const { value, target, ratio } = progress;
  const unit = unitOf(goal);
  const count =
    goal.sourceKind === "project"
      ? GOALS_COPY.projectCount(value)
      : GOALS_COPY.count(value, target, unit);
  const period = periodOf(goal);
  let line: string | null = null;
  let pace: Pace | null = null;
  if (goal.status === "achieved") {
    // Achieved by reaching the target or by hand: either way it stays achieved (no pace).
    line = GOALS_COPY.paceDone;
  } else if (goal.status === "active" && periodPhase(period, today) === "past") {
    // Over without reaching it: the final value, as a fact (no alarm, the status is untouched).
    line = GOALS_COPY.finalValue(count);
  } else if (goal.status === "active" && goal.sourceKind !== "project") {
    // A project goal has no pace: its date is the project's own (SPEC-goals "Ritmo").
    pace = paceOf({ value, target, period, today });
    line = paceLine(pace, unit, periodBounds(period).start);
  }
  return { kind: "ok", value, target, ratio, count, source: sourceLinkOf(goal), line, pace };
}

/** The sentence of a pace: a next step, never a reproach. */
export function paceLine(pace: Pace, unit: string, periodStart: string): string | null {
  switch (pace.kind) {
    case "ahead":
      return GOALS_COPY.paceAhead(pace.by);
    case "on":
      return GOALS_COPY.paceOn;
    case "next-step":
      return GOALS_COPY.paceNextStep(pace.perWeekNeeded, unit);
    case "done":
      return GOALS_COPY.paceDone;
    case "upcoming":
      return GOALS_COPY.paceUpcoming(formatDateKey(periodStart, "long"));
    case "past":
      return null;
  }
}
