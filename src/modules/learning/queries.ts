// Reads of `learning` for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
// `learning` reads `projects` only through its contract (eslint.config.mjs).
import { getProjectOptions, selectProjectsProgress } from "@/modules/projects/contracts";
import { selectSteps } from "./steps";
import type { StepItem } from "./steps-input";
import {
  selectActiveTrackRefs,
  selectDeletedTrack,
  selectTrackItem,
  selectTrackItems,
} from "./tracks";
import type { DeletedTrack, ProjectChoice, TrackItem, TrackRef } from "./tracks-input";

const trackId = z.uuid();

/** Every live track, each status in its order: the page sorts them into sections. */
export async function listTracks(): Promise<TrackItem[]> {
  await requireOwner();
  return selectTrackItems(getDb());
}

/**
 * A track for its page, or null when it doesn't exist, is deleted or the id is malformed (the page
 * is a 404). Cached per request: the page's metadata reads it too.
 */
export const getTrack = cache(async (id: string): Promise<TrackItem | null> => {
  await requireOwner();
  // Not a uuid: no query (Postgres would reject the cast and quote the value in its error).
  if (!trackId.safeParse(id).success) return null;
  return selectTrackItem(getDb(), id);
});

/** A track's live steps in order (its page's syllabus). */
export async function listSteps(id: string): Promise<StepItem[]> {
  await requireOwner();
  if (!trackId.safeParse(id).success) return [];
  return selectSteps(getDb(), id);
}

/** The tracks in progress (the limit's offer on a track's page). */
export async function listActiveTracks(): Promise<TrackRef[]> {
  await requireOwner();
  return selectActiveTrackRefs(getDb());
}

/** A track just deleted from its page (`?deleted=<id>`), or null when it isn't deleted. */
export async function getDeletedTrack(id: string): Promise<DeletedTrack | null> {
  await requireOwner();
  if (!trackId.safeParse(id).success) return null;
  return selectDeletedTrack(getDb(), id);
}

/**
 * The projects a track can belong to (in Idea, Activo or Pausado, by `projects`' contract) and,
 * when `linkedId` points at one outside that list (finished, say), that one too: the form keeps it.
 */
export async function listProjectChoices(linkedId: string | null = null): Promise<ProjectChoice[]> {
  await requireOwner();
  const options = await getProjectOptions();
  if (linkedId === null || options.some((option) => option.id === linkedId)) return options;
  const linked = (await selectProjectsProgress(getDb(), [linkedId])).get(linkedId);
  return linked ? [...options, { id: linkedId, name: linked.name }] : options;
}
