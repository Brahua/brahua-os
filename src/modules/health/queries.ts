// Reads of `health` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { selectDeletedExercise, selectExercise, selectExercises } from "./exercises";
import type { DeletedExercise, ExerciseItem } from "./exercises-input";
import type { ExerciseKind } from "./health-constants";
import type { ExerciseRecordsView, SessionRecord } from "./records";
import { selectExerciseRecords, selectSessionRecords } from "./records-data";
import { selectRoutineItems } from "./routine-items";
import { nextRoutine, type RotationRoutine } from "./rotation";
import { selectDeletedRoutine, selectRoutine, selectRoutineSummaries } from "./routines";
import type { RoutineItem, RoutineRef, RoutineSummary } from "./routines-input";
import {
  selectDeletedSession,
  selectOpenSession,
  selectRotationRoutines,
  selectSessionDetail,
  selectSessionSummaries,
} from "./sessions";
import type { OpenSession, SessionDetail, SessionSummary } from "./sessions-input";

// Not a uuid: no query (Postgres would reject the cast and quote the value in its error).
const uuid = z.uuid();
const isId = (id: string) => uuid.safeParse(id).success;

/** The live routines in their order (the list on /health). */
export async function listRoutines(): Promise<RoutineSummary[]> {
  await requireOwner();
  return selectRoutineSummaries(getDb());
}

/**
 * A routine for its page, or null when it doesn't exist, is deleted or the id is malformed (the
 * page is a 404). Cached per request: the page's metadata reads it too.
 */
export const getRoutine = cache(async (id: string): Promise<RoutineRef | null> => {
  await requireOwner();
  if (!isId(id)) return null;
  return selectRoutine(getDb(), id);
});

/** A routine's live exercises in order. */
export async function listRoutineItems(id: string): Promise<RoutineItem[]> {
  await requireOwner();
  if (!isId(id)) return [];
  return selectRoutineItems(getDb(), id);
}

/** A routine just deleted from its page (`?deleted=<id>`), or null when it isn't deleted. */
export async function getDeletedRoutine(id: string): Promise<RoutineRef | null> {
  await requireOwner();
  if (!isId(id)) return null;
  return selectDeletedRoutine(getDb(), id);
}

/** The live catalogue (the catalogue screen and the routine's picker). */
export async function listExercises(): Promise<ExerciseItem[]> {
  await requireOwner();
  return selectExercises(getDb());
}

/** An exercise for its page, or null (missing, deleted, malformed). Cached per request. */
export const getExercise = cache(async (id: string): Promise<ExerciseItem | null> => {
  await requireOwner();
  if (!isId(id)) return null;
  return selectExercise(getDb(), id);
});

/** An exercise just deleted from its page (`?deleted=<id>`), or null when it isn't deleted. */
export async function getDeletedExercise(id: string): Promise<DeletedExercise | null> {
  await requireOwner();
  if (!isId(id)) return null;
  return selectDeletedExercise(getDb(), id);
}

// ── E2: sessions ───────────────────────────────────────────────────────────────────────────

/**
 * A live session for its screen, or null when it doesn't exist, is deleted or the id is
 * malformed (the page is a 404). Cached per request: the page's metadata reads it too.
 */
export const getSession = cache(async (id: string): Promise<SessionDetail | null> => {
  await requireOwner();
  if (!isId(id)) return null;
  return selectSessionDetail(getDb(), id);
});

/** The open session («Seguir»), or null. */
export async function getOpenSession(): Promise<OpenSession | null> {
  await requireOwner();
  return selectOpenSession(getDb());
}

/** The routine that comes next by the rotation (SPEC-health "Rotación"), or null. */
export async function getNextRoutine(): Promise<RotationRoutine | null> {
  await requireOwner();
  return nextRoutine(await selectRotationRoutines(getDb()));
}

/** The newest `limit` live sessions and how many there are. */
export async function listSessions(
  limit: number,
): Promise<{ sessions: SessionSummary[]; total: number }> {
  await requireOwner();
  return selectSessionSummaries(getDb(), limit);
}

/** A session just deleted or discarded (`?deleted=<id>`), or null when it isn't deleted. */
export async function getDeletedSession(
  id: string,
): Promise<{ id: string; routineName: string | null } | null> {
  await requireOwner();
  if (!isId(id)) return null;
  return selectDeletedSession(getDb(), id);
}

// ── E3: records and history ─────────────────────────────────────────────────────────────────

/** The new records of a finished session (its summary); empty for an open or missing one. */
export async function getSessionRecords(id: string): Promise<SessionRecord[]> {
  await requireOwner();
  if (!isId(id)) return [];
  return selectSessionRecords(getDb(), id);
}

/** An exercise's records, line and the newest `limit` sessions of its history. */
export async function getExerciseRecords(
  exercise: { id: string; kind: ExerciseKind },
  limit: number,
): Promise<ExerciseRecordsView> {
  await requireOwner();
  return selectExerciseRecords(getDb(), exercise.id, exercise.kind, limit);
}
