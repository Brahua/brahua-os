import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { RoutineDeletedNotice } from "@/modules/health/components/deleted-notice";
import { HealthHome } from "@/modules/health/components/health-home";
import { RoutinesSection } from "@/modules/health/components/routines-section";
import { RecentSessions } from "@/modules/health/components/session-rows";
import { SessionStart } from "@/modules/health/components/session-start";
import { RECENT_SESSIONS } from "@/modules/health/health-constants";
import { HEALTH_COPY as COPY } from "@/modules/health/health-copy";
import {
  getDeletedRoutine,
  getNextRoutine,
  getOpenSession,
  listRoutines,
  listSessions,
} from "@/modules/health/queries";
import { DELETED_PARAM } from "@/modules/health/routes";

export const metadata: Metadata = { title: `${COPY.pageTitle} · brahua-os` };

const HEADING_ID = "health-title";

type HealthPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Entreno (SPEC-health "Pantallas"): on top the open session («Seguir») or «Empezar» with the
 * routine the rotation says, «Otra rutina» and «Sesión libre»; then «Rutinas», «Últimas sesiones»
 * (10) and the link to «Ejercicios».
 */
export default async function HealthPage({ searchParams }: HealthPageProps) {
  await requireOwner();
  const search = await searchParams;
  const deletedId = search[DELETED_PARAM];
  const [routines, open, next, recent, deleted] = await Promise.all([
    listRoutines(),
    getOpenSession(),
    getNextRoutine(),
    listSessions(RECENT_SESSIONS),
    // Just deleted from its page: the undo notice needs its name (only while it is deleted).
    typeof deletedId === "string" ? getDeletedRoutine(deletedId) : Promise.resolve(null),
  ]);

  return (
    <ScreenServicesProvider label={COPY.noticesLabel} actionHint={COPY.undoHint}>
      {/* Bottom padding grows with the notice (--toast-offset): a move leaves a «Deshacer»
          notice, and the last row must stay reachable under it at full scroll. */}
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <HealthHome
          headingId={HEADING_ID}
          session={<SessionStart open={open} next={next} routines={routines} />}
          routines={<RoutinesSection routines={routines} />}
          recent={<RecentSessions sessions={recent.sessions} />}
        />
        <RoutineDeletedNotice headingId={HEADING_ID} deleted={deleted} />
      </div>
    </ScreenServicesProvider>
  );
}
