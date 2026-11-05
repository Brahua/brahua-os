// Records (SPEC-health "Récords"): computed on read, never stored. Client-safe and pure.
//
// The input is the done, non-warmup sets of finished, live sessions (live session exercises and
// live sets too): records-data.ts reads exactly those. Per exercise, by its CURRENT kind (a kind
// switch stays within its family, weight_reps ↔ reps or time ↔ cardio: E1), each metric uses the
// fields it needs and skips a set without them:
//
// - weight_reps → «Peso máximo» (any reps ≥ 1, weight > 0) and «1RM estimado» (Epley,
//   `w × (1 + reps/30)`, only with 1–12 reps; with 1 rep it is the weight itself).
// - reps → most reps in one set (the optional extra weight is not part of it).
// - time → most seconds. cardio → longest distance and longest time.
//
// Values are compared as whole-number scores, exactly: grams, reps, seconds, meters; the 1RM as
// `30 × e1RM` in grams (`w × 30` with 1 rep, `w × (30 + reps)` from 2), so a tie is a real tie.
// The 1RM is shown rounded to the nearest 0,5 kg (halves up): two scores can read the same.
//
// A record is NEW in a session when its best strictly beats the best of every session of that
// exercise that STARTED EARLIER (a later session never takes a record back from an older one). The
// first value ever of a metric is not new (nothing to beat), and a tie is not new.
import type { ExerciseKind } from "./health-constants";

export const RECORD_METRICS = [
  "maxWeight",
  "e1rm",
  "maxReps",
  "maxSeconds",
  "maxDistance",
] as const;
export type RecordMetric = (typeof RECORD_METRICS)[number];

/** The metrics of each kind, in the order the screens list them. */
export const METRICS_BY_KIND: Record<ExerciseKind, readonly RecordMetric[]> = {
  weight_reps: ["maxWeight", "e1rm"],
  reps: ["maxReps"],
  time: ["maxSeconds"],
  cardio: ["maxDistance", "maxSeconds"],
};

/** Epley counts up to this many reps (more says little about a single). */
export const E1RM_MAX_REPS = 12;
/** The 1RM is shown rounded to this step (grams). */
export const E1RM_DISPLAY_STEP_GRAMS = 500;

/** One done, non-warmup set of a finished, live session, with what records need. */
export type RecordSet = {
  sessionId: string;
  /** The session's start (ISO): «earlier» compares it. */
  startedAt: string;
  exerciseId: string;
  weightGrams: number | null;
  reps: number | null;
  seconds: number | null;
  distanceMeters: number | null;
};

/** A metric's comparable score for one set, or null when the set doesn't count for it. */
export function scoreOf(
  metric: RecordMetric,
  set: Omit<RecordSet, "sessionId" | "startedAt" | "exerciseId">,
): number | null {
  const { weightGrams: w, reps, seconds, distanceMeters } = set;
  switch (metric) {
    case "maxWeight":
      return w !== null && w > 0 && reps !== null && reps >= 1 ? w : null;
    case "e1rm":
      if (w === null || w <= 0 || reps === null || reps < 1 || reps > E1RM_MAX_REPS) return null;
      return reps === 1 ? w * 30 : w * (30 + reps);
    case "maxReps":
      return reps !== null && reps >= 1 ? reps : null;
    case "maxSeconds":
      return seconds !== null && seconds >= 1 ? seconds : null;
    case "maxDistance":
      return distanceMeters !== null && distanceMeters > 0 ? distanceMeters : null;
  }
}

/** The 1RM in grams (exact) of `w` × `reps`, or null outside 1–12 reps: Epley. */
export function estimatedOneRepMax(weightGrams: number, reps: number): number | null {
  const score = scoreOf("e1rm", { weightGrams, reps, seconds: null, distanceMeters: null });
  return score === null ? null : score / 30;
}

/**
 * A score in the unit the screens show: grams (the 1RM rounded to 0,5 kg), reps, seconds or
 * meters.
 */
export function displayValue(metric: RecordMetric, score: number): number {
  if (metric !== "e1rm") return score;
  return Math.round(score / 30 / E1RM_DISPLAY_STEP_GRAMS) * E1RM_DISPLAY_STEP_GRAMS;
}

type SessionBest = { sessionId: string; startedAt: string; scores: Map<RecordMetric, number> };

/** Each session's best score per metric of one exercise, the oldest session first. */
function bestsBySession(sets: readonly RecordSet[], kind: ExerciseKind): SessionBest[] {
  const metrics = METRICS_BY_KIND[kind];
  const sessions = new Map<string, SessionBest>();
  for (const set of sets) {
    let best = sessions.get(set.sessionId);
    if (!best) {
      best = { sessionId: set.sessionId, startedAt: set.startedAt, scores: new Map() };
      sessions.set(set.sessionId, best);
    }
    for (const metric of metrics) {
      const score = scoreOf(metric, set);
      if (score === null) continue;
      const current = best.scores.get(metric);
      if (current === undefined || score > current) best.scores.set(metric, score);
    }
  }
  return [...sessions.values()].sort(compareSessions);
}

const compareSessions = (a: { startedAt: string; sessionId: string }, b: typeof a) =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.sessionId.localeCompare(b.sessionId);

const byExercise = (sets: readonly RecordSet[]) => {
  const groups = new Map<string, RecordSet[]>();
  for (const set of sets) {
    const group = groups.get(set.exerciseId) ?? [];
    group.push(set);
    groups.set(set.exerciseId, group);
  }
  return groups;
};

/** A new record: what a session beat. */
export type NewRecord = {
  sessionId: string;
  exerciseId: string;
  metric: RecordMetric;
  score: number;
};

/**
 * Every new record in `sets`, per session, exercise and metric (see the header). `kinds` gives each
 * exercise's current kind; an exercise without one is skipped. In the order of the sessions
 * (oldest first), then of `kinds`' metrics.
 */
export function newRecords(
  sets: readonly RecordSet[],
  kinds: ReadonlyMap<string, ExerciseKind>,
): NewRecord[] {
  const found: NewRecord[] = [];
  for (const [exerciseId, group] of byExercise(sets)) {
    const kind = kinds.get(exerciseId);
    if (!kind) continue;
    const sessions = bestsBySession(group, kind);
    // The best of the sessions that started strictly earlier; sessions with the same start are
    // compared against the same «before» and only then join it.
    const before = new Map<RecordMetric, number>();
    let index = 0;
    while (index < sessions.length) {
      const start = Date.parse(sessions[index].startedAt);
      let end = index;
      while (end < sessions.length && Date.parse(sessions[end].startedAt) === start) end++;
      const same = sessions.slice(index, end);
      for (const session of same) {
        for (const metric of METRICS_BY_KIND[kind]) {
          const score = session.scores.get(metric);
          const previous = before.get(metric);
          if (score !== undefined && previous !== undefined && score > previous) {
            found.push({ sessionId: session.sessionId, exerciseId, metric, score });
          }
        }
      }
      for (const session of same) {
        for (const [metric, score] of session.scores) {
          const previous = before.get(metric);
          if (previous === undefined || score > previous) before.set(metric, score);
        }
      }
      index = end;
    }
  }
  return found;
}

/** How many new records each session has (only those with at least one). */
export function newRecordCounts(
  sets: readonly RecordSet[],
  kinds: ReadonlyMap<string, ExerciseKind>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of newRecords(sets, kinds)) {
    counts.set(record.sessionId, (counts.get(record.sessionId) ?? 0) + 1);
  }
  return counts;
}

/** An exercise's record of one metric: the best score and the first session that reached it. */
export type ExerciseRecord = {
  metric: RecordMetric;
  score: number;
  sessionId: string;
  startedAt: string;
};

/** An exercise's records (one per metric of its kind that has a value), in the kind's order. */
export function exerciseRecords(sets: readonly RecordSet[], kind: ExerciseKind): ExerciseRecord[] {
  const sessions = bestsBySession(sets, kind);
  const records: ExerciseRecord[] = [];
  for (const metric of METRICS_BY_KIND[kind]) {
    let best: ExerciseRecord | null = null;
    // Oldest first and strictly greater: a tie keeps the session that reached it first.
    for (const session of sessions) {
      const score = session.scores.get(metric);
      if (score !== undefined && (best === null || score > best.score)) {
        best = { metric, score, sessionId: session.sessionId, startedAt: session.startedAt };
      }
    }
    if (best) records.push(best);
  }
  return records;
}

/**
 * The metric the exercise page draws (SPEC-health "Detalle del ejercicio"): the best weight, reps
 * or time; for cardio the distance when any session has one, else the time.
 */
export function lineMetric(kind: ExerciseKind, sets: readonly RecordSet[]): RecordMetric {
  switch (kind) {
    case "weight_reps":
      return "maxWeight";
    case "reps":
      return "maxReps";
    case "time":
      return "maxSeconds";
    case "cardio":
      return sets.some((set) => scoreOf("maxDistance", set) !== null)
        ? "maxDistance"
        : "maxSeconds";
  }
}

export type LinePoint = { sessionId: string; startedAt: string; value: number };

/**
 * The best of `metric` per session that started at or after `from` (ISO), the oldest first, in
 * the unit the screens show (displayValue). Sessions without a value for it are left out.
 */
export function bestLine(
  sets: readonly RecordSet[],
  metric: RecordMetric,
  from: string,
): LinePoint[] {
  const since = Date.parse(from);
  const inWindow = sets.filter((set) => Date.parse(set.startedAt) >= since);
  const sessions = new Map<string, LinePoint & { score: number }>();
  for (const set of inWindow) {
    const score = scoreOf(metric, set);
    if (score === null) continue;
    const current = sessions.get(set.sessionId);
    if (!current || score > current.score) {
      sessions.set(set.sessionId, {
        sessionId: set.sessionId,
        startedAt: set.startedAt,
        value: displayValue(metric, score),
        score,
      });
    }
  }
  return [...sessions.values()]
    .sort(compareSessions)
    .map(({ sessionId, startedAt, value }) => ({ sessionId, startedAt, value }));
}

// ── What the screens get ─────────────────────────────────────────────────────────────────────

/** A new record of a session as its summary lists it («Sentadilla con barra: 82,5 kg»). */
export type SessionRecord = {
  exerciseId: string;
  exerciseName: string;
  metric: RecordMetric;
  /** In the unit the screens show (displayValue). */
  value: number;
};

/** An exercise's page: its records, the line and the history by session. */
export type ExerciseRecordsView = {
  records: (ExerciseRecord & { value: number })[];
  /** What the line draws. */
  lineMetric: RecordMetric;
  line: LinePoint[];
  /** The newest sessions first, each with its sets summarised («80 kg × 8 · 80 × 8»). */
  history: { sessionId: string; startedAt: string; routineName: string | null; sets: string }[];
  /** How many sessions did the exercise (the history's «Ver más»). */
  totalSessions: number;
};
