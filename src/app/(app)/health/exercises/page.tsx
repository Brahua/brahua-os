import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { ExerciseDeletedNotice } from "@/modules/health/components/deleted-notice";
import { ExercisesScreen } from "@/modules/health/components/exercises-screen";
import { EXERCISES_COPY as COPY } from "@/modules/health/exercises-copy";
import { HEALTH_COPY } from "@/modules/health/health-copy";
import { getDeletedExercise, listExercises } from "@/modules/health/queries";
import { DELETED_PARAM, HEALTH_PATH } from "@/modules/health/routes";

export const metadata: Metadata = {
  title: `${COPY.pageTitle} · ${HEALTH_COPY.pageTitle} · brahua-os`,
};

const HEADING_ID = "exercises-title";

type ExercisesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The exercise catalogue (SPEC-health "Pantallas"): every live exercise, filtered on the client. */
export default async function ExercisesPage({ searchParams }: ExercisesPageProps) {
  await requireOwner();
  const search = await searchParams;
  const deletedId = search[DELETED_PARAM];
  const [exercises, deleted] = await Promise.all([
    listExercises(),
    typeof deletedId === "string" ? getDeletedExercise(deletedId) : Promise.resolve(null),
  ]);

  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <Link
          href={HEALTH_PATH}
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {COPY.backToHealth}
        </Link>
        <ExercisesScreen exercises={exercises} headingId={HEADING_ID} />
        <ExerciseDeletedNotice headingId={HEADING_ID} deleted={deleted} />
      </div>
    </ScreenServicesProvider>
  );
}
