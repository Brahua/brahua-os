import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { SessionScreen } from "@/modules/health/components/session-screen";
import { HEALTH_COPY } from "@/modules/health/health-copy";
import { getSession, getSessionRecords, listExercises } from "@/modules/health/queries";
import { HEALTH_PATH } from "@/modules/health/routes";
import { SESSIONS_COPY as COPY } from "@/modules/health/sessions-copy";

type SessionPageProps = { params: Promise<{ id: string }> };

const HEADING_ID = "session-title";

export async function generateMetadata({ params }: SessionPageProps): Promise<Metadata> {
  const { id } = await params;
  const session = await getSession(id);
  // The page's metadata also applies to its not-found.tsx (which can't set its own here).
  if (!session) return { title: COPY.notFoundTitle, robots: { index: false, follow: false } };
  return { title: COPY.detailTitle(COPY.routineOrFree(session.routineName)) };
}

/**
 * A session's screen (SPEC-health "Pantallas"): open or finished, with the catalogue for «Agregar
 * ejercicio» and, finished, its new records (E3). Missing, deleted or malformed ids are a 404. The screen runs on its own state after
 * this first read (its actions don't revalidate it).
 */
export default async function SessionPage({ params }: SessionPageProps) {
  await requireOwner();
  const { id } = await params;
  const [session, exercises, records] = await Promise.all([
    getSession(id),
    listExercises(),
    getSessionRecords(id),
  ]);
  if (!session) notFound();

  return (
    <ScreenServicesProvider label={HEALTH_COPY.noticesLabel} actionHint={HEALTH_COPY.undoHint}>
      {/* Bottom padding grows with the notice and the rest bar (--toast-offset,
          --rest-bar-offset): the last set and «Terminar» stay reachable under both. */}
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px)+var(--rest-bar-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px)+var(--rest-bar-offset,0px))]">
        <Link
          href={HEALTH_PATH}
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          {COPY.backToHealth}
        </Link>
        <SessionScreen
          key={session.id}
          session={session}
          catalogue={exercises}
          records={records}
          headingId={HEADING_ID}
        />
      </div>
    </ScreenServicesProvider>
  );
}
