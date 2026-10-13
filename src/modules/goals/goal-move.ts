// "Pasar al próximo periodo" (SPEC-goals "Pantallas", historia 5): which goals can move and to
// where. Pure and client-safe; the server and the screens read the same rule.
import type { GoalItem } from "./goal-input";
import { GOAL_YEAR_MAX } from "./goal-constants";
import { GOALS_COPY } from "./goals-copy";
import { nextPeriod, periodLabel, periodOf, periodPhase, type GoalPeriod } from "./pace";

/**
 * The period a goal moves to, or null when it can't move. An in-course (`active`) goal whose
 * period is current or over can (the owner may roll a goal over early); one that is achieved,
 * archived, or whose period has not started stays (decisión autónoma para revisar con el owner).
 */
export function movePeriodOf(goal: GoalItem, today: string): GoalPeriod | null {
  if (goal.status !== "active") return null;
  const period = periodOf(goal);
  if (periodPhase(period, today) === "upcoming") return null;
  const next = nextPeriod(period);
  return next.year > GOAL_YEAR_MAX ? null : next;
}

/** The goal as the screen shows it once moved to `period` (its entries and source stay). */
export function movedPatch(period: GoalPeriod): Pick<GoalItem, "year" | "quarter" | "periodKind"> {
  return {
    periodKind: period.kind,
    year: period.year,
    quarter: period.kind === "quarter" ? period.quarter : null,
  };
}

/** The label of the move key: "Pasar a T1 2027" (null: the goal can't move). */
export function moveLabelOf(goal: GoalItem, today: string): string | null {
  const next = movePeriodOf(goal, today);
  return next ? GOALS_COPY.moveToNext(periodLabel(next)) : null;
}
