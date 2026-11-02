// What `learning` hands its consumers (SPEC-learning "Contratos", L3): Hoy's «Estudio», the
// projects' progress and the weekly review. Types and pure rules only, client-safe: the reads live
// in contracts.ts (server) and progress-source.ts.
import type { TrackKind, TrackStatus } from "./learning-constants";
import type { RunningSession } from "./sessions-input";
import type { StepRef } from "./tracks-input";

/** A track in progress as Hoy's «Sigue con» card shows it. */
export type LearningTodayTrack = {
  id: string;
  title: string;
  kind: TrackKind;
  /** Its live steps: done of total (no syllabus: 0 of 0). */
  steps: { done: number; total: number };
  /** Its next live steps not done, in order (up to two: «Hecho» already shows the one after). */
  upcoming: StepRef[];
  /** Minutes of this Lima week (ended sessions that started in it). */
  weekMinutes: number;
  /** The weekly target in minutes, or null. */
  weeklyTargetMinutes: number | null;
};

/** Hoy's «Estudio»: the tracks in progress (≤ 2, by their order) and the timer that runs now. */
export type LearningTodaySummary = {
  tracks: LearningTodayTrack[];
  /** The one timer of the app (any track's, maybe one not in progress), or null. */
  running: RunningSession | null;
};

/** The weekly review's «Estudio»: minutes of the ended sessions that started in that Lima week. */
export type LearningWeekReview = { minutes: number };

/**
 * How much of one unit a track contributes to its project's progress (SPEC-learning "Proyecto"):
 * a finished track is 1; otherwise its live steps done over its live steps; a practice, or a track
 * without a syllabus yet, is 0 until it is finished.
 */
export function trackShare({
  kind,
  status,
  done,
  total,
}: {
  kind: TrackKind;
  status: TrackStatus;
  done: number;
  total: number;
}): number {
  if (status === "done") return 1;
  if (kind === "practice" || total <= 0) return 0;
  return Math.min(1, Math.max(0, done) / total);
}
