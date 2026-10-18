"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { ProgressMeter } from "@/modules/projects/components/progress-meter";
import { MILESTONES_COPY } from "@/modules/projects/milestones-copy";
import { milestoneProgress } from "@/modules/projects/progress";
import type { ProgressCounts } from "@/modules/projects/progress-source";
import { useProjectDetail } from "./project-detail-context";

// "Cerrar proyecto" counts the open phases (milestones not complete) and lives apart from the
// milestones section (each section only has the page's provider). So the milestones section
// publishes the phase counts of what it shows (its optimistic view) here, and "Cerrar" reads them:
// adding or deleting a milestone moves the count at once, and a rollback moves it back.

/** Complete and total phases (milestones) as the section shows them. */
type PhaseCounts = ProgressCounts;

type Published = PhaseCounts & { projectId: string };

let published: Published | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => published;
const serverSnapshot = () => null;

function publish(next: Published | null) {
  published = next;
  for (const listener of listeners) listener();
}

/** For the milestones section: keeps the meter on the counts it shows. */
export function usePublishMilestoneCounts(projectId: string, { done, total }: PhaseCounts) {
  useLayoutEffect(() => {
    if (
      published?.projectId !== projectId ||
      published.done !== done ||
      published.total !== total
    ) {
      publish({ projectId, done, total });
    }
  }, [projectId, done, total]);
  useLayoutEffect(
    () => () => {
      if (published?.projectId === projectId) publish(null);
    },
    [projectId],
  );
}

/**
 * The milestone counts as shown: the milestones section's live ones once it has published them,
 * else `counts` (what the server sent). The meter and "Cerrar proyecto" read them.
 */
export function useMilestoneCounts(projectId: string, counts: PhaseCounts): PhaseCounts {
  const live = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return live?.projectId === projectId ? live : counts;
}

/**
 * The project's progress under its dates (the P3 slot of `ProjectPlanSection`): the tasks done of
 * all (hitos-agrupan-tareas: a milestone is a phase that groups tasks, not a unit of its own).
 * Nothing without tasks or in Mantenimiento (the state as shown, so changing it hides or shows the
 * meter at once). `contributed` (P6) is what the progress sources (tasks) count.
 */
export function ProjectProgress({ contributed }: { contributed?: ProgressCounts }) {
  const { project } = useProjectDetail();
  const progress = milestoneProgress(contributed, project.status);
  if (!progress) return null;
  return (
    <div className="flex flex-col gap-2" data-project-progress>
      <h3 className="bo-field__label">{MILESTONES_COPY.progressLabel}</h3>
      <ProgressMeter progress={progress} variant="detail" />
    </div>
  );
}
