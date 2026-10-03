import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { listLifeAreas } from "@/modules/core/queries";
import { HabitViewTabs } from "@/modules/habits/components/habit-view-tabs";
import { HabitsDeletedNotice } from "@/modules/habits/components/habits-deleted-notice";
import { HabitsScreen } from "@/modules/habits/components/habits-screen";
import { HabitsToday } from "@/modules/habits/components/habits-today";
import { HabitsWeekView } from "@/modules/habits/components/habits-week";
import type { HabitAreaSummary } from "@/modules/habits/habit-input";
import { HISTORY_COPY } from "@/modules/habits/history-copy";
import {
  getDeletedHabit,
  getHabitsWeek,
  listActiveHabits,
  listArchivedHabits,
} from "@/modules/habits/queries";
import { DELETED_PARAM, parseHabitView, VIEW_PARAM, WEEK_PARAM } from "@/modules/habits/routes";

const HEADING_ID = "habits-title";

type SearchParams = Record<string, string | string[] | undefined>;

type HabitsPageProps = {
  searchParams: Promise<SearchParams>;
};

/** Each view has its own title: a view switch is announced. "Hoy" keeps the module's. */
export async function generateMetadata({ searchParams }: HabitsPageProps): Promise<Metadata> {
  const view = parseHabitView((await searchParams)[VIEW_PARAM]);
  return { title: view === "semana" ? HISTORY_COPY.weekPageTitle : "Hábitos · brahua-os" };
}

/**
 * Hábitos (SPEC-habits "Pantallas"): the views as links (`?vista=`, like tasks). "Hoy" (H1–H4):
 * the pads of today's habits. "Semana" (H5): the week's total and each habit's 7 days
 * (`?semana=`), and "Archivados". Each view reads only what it shows.
 */
export default async function HabitsPage({ searchParams }: HabitsPageProps) {
  await requireOwner();
  const search = await searchParams;
  const view = parseHabitView(search[VIEW_PARAM]);
  // One instant for the whole page: every pad logs the same Lima day.
  const now = new Date();
  const today = ownerDateKey(now);
  // Read along with each view's data (the create and edit form's picker).
  const areasRead = listLifeAreas().then((lifeAreas) =>
    lifeAreas.map(({ id, slug, name, icon, color }): HabitAreaSummary => ({
      id,
      slug,
      name,
      icon,
      color,
    })),
  );
  const viewSwitch = <HabitViewTabs current={view} />;

  if (view === "semana") {
    const [week, archived, areas] = await Promise.all([
      getHabitsWeek(now, search[WEEK_PARAM]),
      listArchivedHabits(now),
      areasRead,
    ]);
    return (
      <HabitsScreen today={today} areas={areas}>
        <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
          <HabitsWeekView
            week={week}
            archived={archived}
            today={today}
            headingId={HEADING_ID}
            viewSwitch={viewSwitch}
          />
        </div>
      </HabitsScreen>
    );
  }

  const deletedId = search[DELETED_PARAM];
  const [habits, areas, deleted] = await Promise.all([
    listActiveHabits(now),
    areasRead,
    // Just deleted from its page: the undo notice needs its name (only while it is deleted).
    typeof deletedId === "string" ? getDeletedHabit(deletedId) : Promise.resolve(null),
  ]);

  return (
    <HabitsScreen today={today} areas={areas}>
      {/* Bottom padding grows with the notice (--toast-offset): every tap leaves a "Deshacer"
          notice, and the last row of pads must stay reachable under it at full scroll. */}
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <HabitsToday habits={habits} headingId={HEADING_ID} viewSwitch={viewSwitch} />
        <HabitsDeletedNotice headingId={HEADING_ID} deleted={deleted} />
      </div>
    </HabitsScreen>
  );
}
