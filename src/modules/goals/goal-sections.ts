// Which section of /goals a goal belongs to (SPEC-goals "Pantallas"). Pure and client-safe.
import type { GoalItem } from "./goal-input";
import { periodBounds, periodOf, periodPhase } from "./pace";

export type GoalSection = "quarter" | "year" | "previous";

/**
 * A goal sits in its period's section while the period is current (or has not started); once the
 * period is over, or when it is archived, it is in "Anteriores" with its status untouched
 * (SPEC-goals "Cierre": the end of a period never changes a goal's state).
 */
export function sectionOf(goal: GoalItem, today: string): GoalSection {
  if (goal.status === "archived") return "previous";
  if (periodPhase(periodOf(goal), today) === "past") return "previous";
  return goal.periodKind;
}

export type GoalSections = Record<GoalSection, GoalItem[]>;

/**
 * The goals sorted into the sections, each in the order the goals come in (the manual order: the
 * server reads them by `position`, and an optimistic reorder rearranges the array); "Anteriores"
 * shows the most recent period first, then that order.
 */
export function groupGoals(goals: readonly GoalItem[], today: string): GoalSections {
  const sections: GoalSections = { quarter: [], year: [], previous: [] };
  for (const goal of goals) sections[sectionOf(goal, today)].push(goal);
  const end = (goal: GoalItem) => periodBounds(periodOf(goal)).end;
  sections.previous.sort((a, b) => (end(a) < end(b) ? 1 : end(a) > end(b) ? -1 : 0));
  return sections;
}
