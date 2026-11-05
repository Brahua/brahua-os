import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { ExerciseDetail } from "@/modules/health/components/exercise-detail";
import { ExerciseRecords } from "@/modules/health/components/exercise-records";
import { EXERCISES_COPY as COPY } from "@/modules/health/exercises-copy";
import { HISTORY_MAX, HISTORY_PAGE } from "@/modules/health/health-constants";
import { HEALTH_COPY } from "@/modules/health/health-copy";
import { getExercise, getExerciseRecords } from "@/modules/health/queries";
import { EXERCISES_PATH, HISTORY_COUNT_PARAM } from "@/modules/health/routes";

type ExercisePageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** How many sessions the history shows: `?n=` rounded to whole pages, from one page to the max. */
function shownCount(value: string | string[] | undefined): number {
  const requested = typeof value === "string" && /^\d{1,5}$/.test(value) ? Number(value) : 0;
  const pages = Math.max(1, Math.ceil(requested / HISTORY_PAGE));
  return Math.min(pages * HISTORY_PAGE, HISTORY_MAX);
}

const HEADING_ID = "exercise-title";

export async function generateMetadata({ params }: ExercisePageProps): Promise<Metadata> {
  const { id } = await params;
  const exercise = await getExercise(id);
  // The page's metadata also applies to its not-found.tsx (which can't set its own here).
  if (!exercise) return { title: COPY.notFoundTitle, robots: { index: false, follow: false } };
  return { title: COPY.detailTitle(exercise.name) };
}

/**
 * An exercise's page (SPEC-health "Pantallas"): its records, the best-of line and the history by
 * session (E3, `?n=` for «Ver más»), then its data (E1). Missing, deleted or malformed ids are a
 * 404.
 */
export default async function ExercisePage({ params, searchParams }: ExercisePageProps) {
  await requireOwner();
  const { id } = await params;
  const search = (await searchParams) ?? {};
  const exercise = await getExercise(id);
  if (!exercise) notFound();
  const shown = shownCount(search[HISTORY_COUNT_PARAM]);
  const view = await getExerciseRecords(exercise, shown);

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
        <ExerciseDetail
          key={exercise.id}
          exercise={exercise}
          headingId={HEADING_ID}
          records={<ExerciseRecords exerciseId={exercise.id} view={view} shown={shown} />}
        />
      </div>
    </ScreenServicesProvider>
  );
}
