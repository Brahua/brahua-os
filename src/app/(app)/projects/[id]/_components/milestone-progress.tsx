"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { ProgressMeter } from "@/modules/projects/components/progress-meter";
import type { MilestoneCounts } from "@/modules/projects/milestone-input";
import { MILESTONES_COPY } from "@/modules/projects/milestones-copy";
import { milestoneProgress } from "@/modules/projects/progress";
import { combineProgressCounts, type ProgressCounts } from "@/modules/projects/progress-source";
import { useProjectDetail } from "./project-detail-context";

// The progress meter sits in "Objetivo y fechas" and the milestones in their own section, with
// no common parent of their own (each section only has the page's provider). So the milestones
// section publishes the counts of what it shows (its optimistic view) here, and the meter reads
// them: checking a milestone moves the meter at once, and a rollback moves it back.

type Published = MilestoneCounts & { projectId: string };

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
export function usePublishMilestoneCounts(projectId: string, { done, total }: MilestoneCounts) {
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
export function useMilestoneCounts(projectId: string, counts: MilestoneCounts): MilestoneCounts {
  const live = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return live?.projectId === projectId ? live : counts;
}

/**
 * The project's progress under its dates (the P3 slot of `ProjectPlanSection`): done / total
 * milestones. Nothing without milestones or in Mantenimiento (the state as shown, so changing
 * it hides or shows the meter at once). `counts` is what the server sent; the milestones
 * section's live counts win once it has published them. `contributed` (P6) is what other modules
 * (tasks) add, summed to the milestones.
 */
export function ProjectProgress({
  counts,
  contributed,
}: {
  counts: MilestoneCounts;
  contributed?: ProgressCounts;
}) {
  const { project } = useProjectDetail();
  const shown = useMilestoneCounts(project.id, counts);
  const progress = milestoneProgress(combineProgressCounts(shown, contributed), project.status);
  if (!progress) return null;
  return (
    <div className="flex flex-col gap-2" data-project-progress>
      <h3 className="bo-field__label">{MILESTONES_COPY.progressLabel}</h3>
      <ProgressMeter progress={progress} variant="detail" />
    </div>
  );
}
