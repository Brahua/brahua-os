import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { listLifeAreas } from "@/modules/core/queries";
import { HabitsScreen } from "@/modules/habits/components/habits-screen";
import { HabitsToday } from "@/modules/habits/components/habits-today";
import type { HabitAreaSummary } from "@/modules/habits/habit-input";
import { listActiveHabits, listArchivedHabits } from "@/modules/habits/queries";

export const metadata: Metadata = { title: "Hábitos · brahua-os" };

const HEADING_ID = "habits-title";

/**
 * Hábitos (SPEC-habits "Pantallas"). H1: "Hoy", the pads of today's habits. H5 slot (Semana):
 * the views as links (`?vista=`, like tasks), each with its own title.
 */
export default async function HabitsPage() {
  await requireOwner();
  // One instant for the whole page: every pad logs the same Lima day.
  const now = new Date();
  const [habits, archived, lifeAreas] = await Promise.all([
    listActiveHabits(now),
    listArchivedHabits(now),
    listLifeAreas(),
  ]);
  const areas: HabitAreaSummary[] = lifeAreas.map(({ id, slug, name, icon, color }) => ({
    id,
    slug,
    name,
    icon,
    color,
  }));

  return (
    <HabitsScreen today={ownerDateKey(now)} areas={areas}>
      {/* Bottom padding grows with the notice (--toast-offset): every tap leaves a "Deshacer"
          notice, and the last row of pads must stay reachable under it at full scroll. */}
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <HabitsToday habits={habits} archived={archived} headingId={HEADING_ID} />
      </div>
    </HabitsScreen>
  );
}
