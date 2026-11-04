import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { RoutineDetail } from "@/modules/health/components/routine-detail";
import { HEALTH_COPY } from "@/modules/health/health-copy";
import { getRoutine, listExercises, listRoutineItems } from "@/modules/health/queries";
import { HEALTH_PATH } from "@/modules/health/routes";
import { ROUTINES_COPY as COPY } from "@/modules/health/routines-copy";

type RoutinePageProps = { params: Promise<{ id: string }> };

const HEADING_ID = "routine-title";

export async function generateMetadata({ params }: RoutinePageProps): Promise<Metadata> {
  const { id } = await params;
  const routine = await getRoutine(id);
  // The page's metadata also applies to its not-found.tsx (which can't set its own here).
  if (!routine) return { title: COPY.notFoundTitle, robots: { index: false, follow: false } };
  return { title: COPY.detailTitle(routine.name) };
}

/**
 * A routine's page (SPEC-health "Pantallas"): its name and its exercises with their targets, and
 * the catalogue for «Agregar ejercicio». Missing, deleted or malformed ids are a 404.
 */
export default async function RoutinePage({ params }: RoutinePageProps) {
  await requireOwner();
  const { id } = await params;
  const [routine, items, exercises] = await Promise.all([
    getRoutine(id),
    listRoutineItems(id),
    listExercises(),
  ]);
  if (!routine) notFound();

  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      {/* Bottom padding grows with the notice (--toast-offset): every change leaves a notice, and
          the last row must stay reachable under it at full scroll. */}
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <Link
          href={HEALTH_PATH}
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {COPY.backToHealth}
        </Link>
        <RoutineDetail
          key={routine.id}
          routine={routine}
          items={items}
          exercises={exercises}
          headingId={HEADING_ID}
        />
      </div>
    </ScreenServicesProvider>
  );
}
