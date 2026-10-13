// What a goal row says, from its data and the day: "5 de 12 libros" and the pace line. Pure and
// client-safe (the rows and the detail share it, and the tests read it without rendering).
import { formatDateKey } from "@/lib/time";
import type { GoalItem } from "./goal-input";
import { GOALS_COPY } from "./goals-copy";
import { paceOf, periodBounds, periodOf, periodPhase, type Pace } from "./pace";
import { progressOf } from "./progress";

export type GoalReading =
  | {
      kind: "ok";
      value: number;
      target: number;
      /** 0–1, for the bar. */
      ratio: number;
      /** "5 de 12 libros". */
      count: string;
      /** The pace line ("Vas 1 por delante de tu ritmo"), or null when there is nothing to say. */
      line: string | null;
      pace: Pace | null;
    }
  | { kind: "unavailable"; line: string };

/** The unit shown after the numbers. G2 slot: a habit goal counts "días", a project's is "%". */
export function unitOf(goal: Pick<GoalItem, "sourceKind" | "unit">): string {
  if (goal.sourceKind === "habit") return "días";
  if (goal.sourceKind === "project") return "%";
  return goal.unit ?? "";
}

/** How the goal reads on `today` (a Lima day). */
export function readGoal(goal: GoalItem, today: string): GoalReading {
  const progress = progressOf(
    goal,
    goal.sourceKind === "manual" ? { sourceKind: "manual", sum: goal.sum } : null,
  );
  if (progress.kind === "unavailable") {
    return { kind: "unavailable", line: GOALS_COPY.sourceUnavailable };
  }
  const { value, target, ratio } = progress;
  const unit = unitOf(goal);
  const count = GOALS_COPY.count(value, target, unit);
  const period = periodOf(goal);
  let line: string | null = null;
  let pace: Pace | null = null;
  if (goal.status === "achieved") {
    // Achieved by reaching the target or by hand: either way it stays achieved (no pace).
    line = GOALS_COPY.paceDone;
  } else if (goal.status === "active" && periodPhase(period, today) === "past") {
    // Over without reaching it: the final value, as a fact (no alarm, the status is untouched).
    line = GOALS_COPY.finalValue(count);
  } else if (goal.status === "active") {
    pace = paceOf({ value, target, period, today });
    line = paceLine(pace, unit, periodBounds(period).start);
  }
  return { kind: "ok", value, target, ratio, count, line, pace };
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
