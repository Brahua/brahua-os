// What `learning` offers other modules (SPEC-learning "Contratos"). Only `today` and
// `weekly-review` may import it (eslint.config.mjs; `today` also reaches the routes and the «Sigue
// con» cards, `components/study-today`). The progress source of `projects` is registered by the
// composition root src/lib/progress-sources.ts from `./progress-source`.
import "server-only";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { learningTracks } from "./db/schema";
import { addDays, limaDayStart, mondayOf, weekBounds } from "./pace";
import { selectRunningSession, selectStudyMinutes, selectTrackMinutes } from "./sessions";
import type { LearningTodaySummary, LearningWeekReview } from "./today-summary";
import { selectTrackItems } from "./tracks";

export type { TrackKind, TrackStatus } from "./learning-constants";
export type { LearningTodaySummary, LearningTodayTrack, LearningWeekReview } from "./today-summary";

/**
 * Hoy's «Estudio» (SPEC-learning "Hoy"): the tracks in progress (≤ 2, by their order) with their
 * next steps, steps done of total, this Lima week's minutes and the weekly target, and the timer
 * that runs now. Three queries. Checks the owner.
 */
export async function getLearningTodaySummary(now: Date): Promise<LearningTodaySummary> {
  await requireOwner();
  const db = getDb();
  const [tracks, running, minutes] = await Promise.all([
    selectTrackItems(db, eq(learningTracks.status, "active")),
    selectRunningSession(db),
    selectTrackMinutes(db, weekBounds(now)),
  ]);
  return {
    tracks: tracks.map((track) => ({
      id: track.id,
      title: track.title,
      kind: track.kind,
      steps: track.steps,
      upcoming: track.upcoming,
      weekMinutes: minutes[track.id]?.week ?? 0,
      weeklyTargetMinutes: track.weeklyTargetMinutes,
    })),
    running,
  };
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The weekly review's «Estudio» (SPEC-learning "Revisión semanal"): the minutes of the ended
 * sessions that started in the Lima week of `weekStart` (its Monday; any day of the week reads
 * that week). A malformed day reads nothing. One query. Checks the owner.
 */
export async function getLearningWeekReview(weekStart: string): Promise<LearningWeekReview> {
  await requireOwner();
  if (!DAY_KEY.test(weekStart) || Number.isNaN(Date.parse(`${weekStart}T00:00:00Z`))) {
    return { minutes: 0 };
  }
  const monday = mondayOf(weekStart);
  const minutes = await selectStudyMinutes(getDb(), {
    from: limaDayStart(monday),
    to: limaDayStart(addDays(monday, 7)),
  });
  return { minutes };
}
