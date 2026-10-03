import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { ownerDateKey } from "@/lib/time";
import { listLifeAreas } from "@/modules/core/queries";
import { monthOf, parseMonthParam } from "@/modules/habits/calendar";
import { HabitDetail } from "@/modules/habits/components/habit-detail";
import { HabitsScreen } from "@/modules/habits/components/habits-screen";
import type { HabitAreaSummary } from "@/modules/habits/habit-input";
import { HISTORY_COPY } from "@/modules/habits/history-copy";
import { getHabitDetail } from "@/modules/habits/queries";
import { HABITS_PATH, habitMonthHref, MONTH_PARAM } from "@/modules/habits/routes";

type HabitPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const HEADING_ID = "habit-title";

/** The oldest day there is: `?mes=` is only kept under today's month until the start is known. */
const NO_START = "0001-01-01";

/** The month the URL asks for, before the habit's start date is known (not after today's). */
function requestedMonth(value: string | string[] | undefined, today: string) {
  return parseMonthParam(value, today, NO_START);
}

export async function generateMetadata({
  params,
  searchParams,
}: HabitPageProps): Promise<Metadata> {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const today = ownerDateKey(new Date());
  const loaded = await getHabitDetail(id, requestedMonth(search[MONTH_PARAM], today), today);
  // The page's metadata also applies to its not-found.tsx (which can't set its own here).
  if (!loaded) {
    return { title: HISTORY_COPY.notFoundTitle, robots: { index: false, follow: false } };
  }
  return { title: `${loaded.item.name} · Hábitos · brahua-os` };
}

/**
 * A habit's page (SPEC-habits "Detalle"; a page at both sizes): its header, stats, monthly
 * calendar (`?mes=YYYY-MM`, back to its start), pauses and actions. Archived habits have one too
 * (read-only, with "Reactivar"). Missing, deleted or malformed ids are a 404.
 */
export default async function HabitPage({ params, searchParams }: HabitPageProps) {
  await requireOwner();
  const [{ id }, search] = await Promise.all([params, searchParams]);
  // One instant for the whole page: the calendar, the stats and a log all use the same Lima day.
  const today = ownerDateKey(new Date());
  const asked = requestedMonth(search[MONTH_PARAM], today);
  const [loaded, lifeAreas] = await Promise.all([
    getHabitDetail(id, asked, today),
    listLifeAreas(),
  ]);
  if (!loaded) notFound();
  const { item, archived, logs, pauses } = loaded;
  // A month before the habit started shows its first month (the URL says so).
  const month = parseMonthParam(search[MONTH_PARAM], today, item.startDate);
  if (month !== asked) redirect(habitMonthHref(id, month === monthOf(today) ? undefined : month));
  const areas: HabitAreaSummary[] = lifeAreas.map(({ id: areaId, slug, name, icon, color }) => ({
    id: areaId,
    slug,
    name,
    icon,
    color,
  }));

  return (
    <HabitsScreen today={today} areas={areas}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <Link
          href={HABITS_PATH}
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {HISTORY_COPY.backToList}
        </Link>
        <HabitDetail
          habit={item}
          archived={archived}
          logs={logs}
          pauses={pauses}
          month={month}
          headingId={HEADING_ID}
        />
      </div>
    </HabitsScreen>
  );
}
