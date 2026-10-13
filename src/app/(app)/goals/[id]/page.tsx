import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { listLifeAreas } from "@/modules/core/queries";
import { GoalDetail } from "@/modules/goals/components/goal-detail";
import { GoalsScreen } from "@/modules/goals/components/goals-screen";
import type { GoalAreaSummary } from "@/modules/goals/goal-input";
import { GOALS_COPY } from "@/modules/goals/goals-copy";
import { getGoal, listGoalEntries, listGoalSourceOptions } from "@/modules/goals/queries";
import { GOALS_PATH } from "@/modules/goals/routes";

type GoalPageProps = { params: Promise<{ id: string }> };

const HEADING_ID = "goal-title";

export async function generateMetadata({ params }: GoalPageProps): Promise<Metadata> {
  const { id } = await params;
  const goal = await getGoal(id);
  // The page's metadata also applies to its not-found.tsx (which can't set its own here).
  if (!goal) return { title: GOALS_COPY.notFoundTitle, robots: { index: false, follow: false } };
  return { title: GOALS_COPY.detailTitle(goal.title) };
}

/**
 * A goal's page (SPEC-goals "Detalle"): its bar and pace, the history of its entries and its
 * actions. Archived goals have one too. Missing, deleted or malformed ids are a 404.
 */
export default async function GoalPage({ params }: GoalPageProps) {
  await requireOwner();
  const { id } = await params;
  // One instant for the whole page: the pace and an entry use the same Lima day.
  const today = ownerDateKey(new Date());
  const [goal, entries, lifeAreas, sources] = await Promise.all([
    getGoal(id),
    listGoalEntries(id),
    listLifeAreas(),
    listGoalSourceOptions(),
  ]);
  if (!goal) notFound();
  const areas = lifeAreas.map(({ id: areaId, slug, name, icon, color }): GoalAreaSummary => ({
    id: areaId,
    slug,
    name,
    icon,
    color,
  }));

  return (
    <GoalsScreen today={today} areas={areas} sources={sources}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <Link
          href={GOALS_PATH}
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {GOALS_COPY.backToList}
        </Link>
        <GoalDetail goal={goal} entries={entries} headingId={HEADING_ID} />
      </div>
    </GoalsScreen>
  );
}
