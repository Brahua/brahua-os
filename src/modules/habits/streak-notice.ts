// H4: the streak milestones a tap reaches (SPEC-habits "Hitos de racha"), for the notice. Pure
// and client-safe: it compares the streak the pad showed before the tap with the one after.
import type { HabitItem } from "./habit-input";
import { isDayDone } from "./habit-status";
import { reachedMilestone, shownStreak, type Streak } from "./streak";

/**
 * The milestone (7, 30, 90 or 365 days or weeks) reached by going from `before` to `after` (the
 * same habit, before and after a tap), or null. A tap that lowers the streak (unmarking, a
 * relapse) never reaches one.
 */
export function streakMilestone(
  before: Pick<HabitItem, "streak" | "kind" | "quantity" | "target">,
  after: Pick<HabitItem, "streak" | "kind" | "quantity" | "target">,
): Streak | null {
  const from = shownStreak(before.streak, isDayDone(before));
  const to = shownStreak(after.streak, isDayDone(after));
  const milestone = reachedMilestone(from.count, to.count);
  return milestone === null ? null : { count: milestone, unit: to.unit };
}
