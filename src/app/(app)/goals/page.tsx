import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { getReviewInviteSlot } from "@/lib/review-extensions";
import { ownerDateKey } from "@/lib/time";
import { listLifeAreas } from "@/modules/core/queries";
import { GoalsDeletedNotice } from "@/modules/goals/components/goals-deleted-notice";
import { GoalsList } from "@/modules/goals/components/goals-list";
import { GoalsScreen } from "@/modules/goals/components/goals-screen";
import type { GoalAreaSummary } from "@/modules/goals/goal-input";
import { GOALS_COPY } from "@/modules/goals/goals-copy";
import {
  getDeletedGoal,
  getWeeklyObjective,
  listGoals,
  listGoalSourceOptions,
} from "@/modules/goals/queries";
import { DELETED_PARAM } from "@/modules/goals/routes";
import { currentWeekStart } from "@/modules/goals/weekly-input";

const HEADING_ID = "goals-title";

export const metadata: Metadata = { title: `${GOALS_COPY.pageTitle} · brahua-os` };

type GoalsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Metas (SPEC-goals "Pantallas"): this quarter's and this year's goals, each with its bar and
 * pace, and the folded "Anteriores". Reads every goal once; the sections are made on the client
 * (an optimistic "+1" can move a goal's state at once).
 */
export default async function GoalsPage({ searchParams }: GoalsPageProps) {
  await requireOwner();
  const search = await searchParams;
  // One instant for the whole page: every row reads its pace for the same Lima day.
  const now = new Date();
  const today = ownerDateKey(now);
  const weekStart = currentWeekStart(today);
  const deletedId = search[DELETED_PARAM];
  const [goals, lifeAreas, sources, deleted, weekly, reviewInvite] = await Promise.all([
    listGoals(),
    listLifeAreas(),
    listGoalSourceOptions(),
    // Just deleted from its page: the undo notice needs its title (only while it is deleted).
    typeof deletedId === "string" ? getDeletedGoal(deletedId) : Promise.resolve(null),
    // "Esta semana": the objective of Lima's week (none yet in a new week).
    getWeeklyObjective(weekStart),
    // W4: the invitation to close the week (Sunday 18:00 → Monday 23:59 Lima), or null.
    getReviewInviteSlot(now),
  ]);
  const areas = lifeAreas.map(({ id, slug, name, icon, color }): GoalAreaSummary => ({
    id,
    slug,
    name,
    icon,
    color,
  }));

  return (
    <GoalsScreen today={today} areas={areas} sources={sources}>
      {/* Bottom padding grows with the notice (--toast-offset): every tap leaves a "Deshacer"
          notice, and the last row must stay reachable under it at full scroll. */}
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        {reviewInvite}
        <GoalsList
          goals={goals}
          weekStart={weekStart}
          weeklyObjective={weekly?.text ?? null}
          headingId={HEADING_ID}
        />
        <GoalsDeletedNotice headingId={HEADING_ID} deleted={deleted} />
      </div>
    </GoalsScreen>
  );
}
