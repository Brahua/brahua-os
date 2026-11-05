import { ChevronRight, Dumbbell } from "lucide-react";
import Link from "next/link";
import { Icon } from "@/design-system";
import { HEALTH_COPY as COPY } from "../health-copy";
import { EXERCISES_PATH } from "../routes";

type HealthHomeProps = {
  /** Id of the page's `<h1 tabIndex={-1}>` (focus lands there after a delete). */
  headingId: string;
  /**
   * The open session («Seguir») or «Empezar» with the routine that comes next
   * (session-start.tsx, SPEC-health "Pantallas"). Nothing shows while it is empty.
   */
  session?: React.ReactNode;
  /** «Rutinas» (routines-section.tsx). */
  routines: React.ReactNode;
  /** «Últimas sesiones» (session-rows.tsx). Nothing shows while it is empty. */
  recent?: React.ReactNode;
  /** E4: the «Ajustes» row of the list (settings-sheet.tsx, an `<li>`), after «Ejercicios». */
  settings?: React.ReactNode;
};

/**
 * /health (SPEC-health "Pantallas"): the title, then the slots in their order (the session on
 * top, «Rutinas», «Últimas sesiones») and the links to «Ejercicios» and «Ajustes» (E4). A
 * Server Component: each slot brings its own client parts.
 */
export function HealthHome({
  headingId,
  session = null,
  routines,
  recent = null,
  settings = null,
}: HealthHomeProps) {
  return (
    <div className="flex flex-col gap-8">
      <h1 id={headingId} tabIndex={-1} className="bo-text-display outline-none">
        {COPY.pageTitle}
      </h1>
      {session}
      {routines}
      {recent}
      <nav aria-label={COPY.more} className="max-w-160">
        <ul className="bo-list">
          <li className="bg-surface">
            <Link
              href={EXERCISES_PATH}
              data-health-exercises-link=""
              className="flex min-h-14 items-center gap-3 rounded-md px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <Icon icon={Dumbbell} size="md" className="shrink-0 text-text-secondary" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="bo-text-body font-medium">{COPY.exercisesLink}</span>
                <span className="bo-text-body-sm text-text-secondary">{COPY.exercisesHelp}</span>
              </span>
              <Icon icon={ChevronRight} size="sm" className="shrink-0 text-text-secondary" />
            </Link>
          </li>
          {settings}
        </ul>
      </nav>
    </div>
  );
}
