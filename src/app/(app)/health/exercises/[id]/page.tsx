import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { ExerciseDetail } from "@/modules/health/components/exercise-detail";
import { EXERCISES_COPY as COPY } from "@/modules/health/exercises-copy";
import { HEALTH_COPY } from "@/modules/health/health-copy";
import { getExercise } from "@/modules/health/queries";
import { EXERCISES_PATH } from "@/modules/health/routes";

type ExercisePageProps = { params: Promise<{ id: string }> };

const HEADING_ID = "exercise-title";

export async function generateMetadata({ params }: ExercisePageProps): Promise<Metadata> {
  const { id } = await params;
  const exercise = await getExercise(id);
  // The page's metadata also applies to its not-found.tsx (which can't set its own here).
  if (!exercise) return { title: COPY.notFoundTitle, robots: { index: false, follow: false } };
  return { title: COPY.detailTitle(exercise.name) };
}

/**
 * An exercise's page (SPEC-health "Pantallas"): its data (E1); the `records` slot of the detail
 * gets its records, line and history in E3. Missing, deleted or malformed ids are a 404.
 */
export default async function ExercisePage({ params }: ExercisePageProps) {
  await requireOwner();
  const { id } = await params;
  const exercise = await getExercise(id);
  if (!exercise) notFound();

  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <Link
          href={EXERCISES_PATH}
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {COPY.backToList}
        </Link>
        <ExerciseDetail key={exercise.id} exercise={exercise} headingId={HEADING_ID} />
      </div>
    </ScreenServicesProvider>
  );
}
