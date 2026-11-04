// Reads of `health` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { selectDeletedExercise, selectExercise, selectExercises } from "./exercises";
import type { DeletedExercise, ExerciseItem } from "./exercises-input";
import { selectRoutineItems } from "./routine-items";
import { selectDeletedRoutine, selectRoutine, selectRoutineSummaries } from "./routines";
import type { RoutineItem, RoutineRef, RoutineSummary } from "./routines-input";

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
