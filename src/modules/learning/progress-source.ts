// The progress source of `learning` (SPEC-learning "Contratos", the P6 contract of `projects`):
// every live track linked to a project is one unit of it, like a task, and contributes its share
// (`trackShare`: steps done over steps, 1 once finished, 0 for a practice or without a syllabus).
// A deleted track, or deleted steps, never count. No milestone counts: a track belongs to the
// project, not to a phase. Registered by the composition root src/lib/progress-sources.ts
// (imported by name in `ensureProgressSources()`); `projects` never imports it.
import "server-only";
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db";
import type { ProgressCounts, ProgressSource } from "@/modules/projects/contracts";
import { learningTracks } from "./db/schema";
import { trackShare } from "./today-summary";
import { liveTrack } from "./tracks";

// Raw subqueries name their tables by hand (CLAUDE.md "household": Drizzle prints a single table's
// columns without it).
const stepCount = (doneOnly: boolean) =>
  sql<number>`(
    select count(*) from learning_steps step
    where step.track_id = "learning_tracks"."id" and step.deleted_at is null
    ${doneOnly ? sql`and step.done_at is not null` : sql``}
  )`.mapWith(Number);

/** Each project's tracks as progress counts: total = live tracks, done = the sum of their shares. */
export async function selectLearningProjectCounts(
  db: Database,
  projectIds: readonly string[],
): Promise<Map<string, ProgressCounts>> {
  const result = new Map<string, ProgressCounts>();
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return result;
  const rows = await db
    .select({
      projectId: learningTracks.projectId,
      kind: learningTracks.kind,
      status: learningTracks.status,
      done: stepCount(true),
      total: stepCount(false),
    })
    .from(learningTracks)
    .where(
      and(liveTrack, isNotNull(learningTracks.projectId), inArray(learningTracks.projectId, ids)),
    );
  for (const row of rows) {
    const projectId = row.projectId as string;
    const counts = result.get(projectId) ?? { done: 0, total: 0 };
    result.set(projectId, {
      done: counts.done + trackShare(row),
      total: counts.total + 1,
    });
  }
  return result;
}

export const learningProgressSource: ProgressSource = {
  id: "learning",
  // One query for every id the list or the detail asks for. The page checked the owner.
  countsFor: (projectIds) => selectLearningProjectCounts(getDb(), projectIds),
};
