"use server";

// Server Actions of `core`. Each one goes through ownerAction(): owner check first, Zod, then an
// ActionResult (SPEC-core "Estilo de código"). Reachable by any POST, so input is `unknown`.
import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ownerAction } from "@/lib/owner-action";
import {
  LIFE_AREA_ERRORS,
  lifeAreaIdInputSchema,
  lifeAreaInputSchema,
  reorderLifeAreasInputSchema,
  unarchiveLifeAreaInputSchema,
  updateLifeAreaInputSchema,
  type LifeAreaSummary,
} from "./life-area-input";
import {
  archiveLifeAreaById,
  insertLifeArea,
  reorderLifeAreasByIds,
  unarchiveLifeAreaById,
  updateLifeAreaById,
} from "./life-areas";
import { getDb } from "@/lib/db";

const AREAS_PATH = "/areas";

const create = ownerAction(
  lifeAreaInputSchema,
  async (data) => {
    const area = await insertLifeArea(getDb(), data);
    revalidatePath(AREAS_PATH);
    return ok(area);
  },
  { name: "createLifeArea" },
);

const update = ownerAction(
  updateLifeAreaInputSchema,
  async (data) => {
    const area = await updateLifeAreaById(getDb(), data);
    if (area === "archived") {
      // The list on screen is out of date: send the fresh one with the error.
      revalidatePath(AREAS_PATH);
      return fail(LIFE_AREA_ERRORS.archived);
    }
    if (!area) return fail(LIFE_AREA_ERRORS.id);
    revalidatePath(AREAS_PATH);
    return ok(area);
  },
  { name: "updateLifeArea" },
);

const reorder = ownerAction(
  reorderLifeAreasInputSchema,
  async ({ ids }) => {
    const areas = await reorderLifeAreasByIds(getDb(), ids);
    // Revalidate either way: on a stale list, the response brings the current one.
    revalidatePath(AREAS_PATH);
    if (!areas) return fail(LIFE_AREA_ERRORS.staleOrder);
    return ok(areas);
  },
  { name: "reorderLifeAreas" },
);

const archive = ownerAction(
  lifeAreaIdInputSchema,
  async ({ id }) => {
    const area = await archiveLifeAreaById(getDb(), id);
    if (!area) return fail(LIFE_AREA_ERRORS.id);
    revalidatePath(AREAS_PATH);
    return ok(area);
  },
  { name: "archiveLifeArea" },
);

const unarchive = ownerAction(
  unarchiveLifeAreaInputSchema,
  async (data) => {
    const area = await unarchiveLifeAreaById(getDb(), data);
    if (!area) return fail(LIFE_AREA_ERRORS.id);
    revalidatePath(AREAS_PATH);
    return ok(area);
  },
  { name: "unarchiveLifeArea" },
);

/** Creates a life area at the end of the list. */
export async function createLifeArea(input: unknown): Promise<ActionResult<LifeAreaSummary>> {
  return create(input);
}

/**
 * Changes an active area's name, color and icon. Its slug and position stay as they are.
 * Archived areas can't be edited until they are unarchived.
 */
export async function updateLifeArea(input: unknown): Promise<ActionResult<LifeAreaSummary>> {
  return update(input);
}

/**
 * Sets the order of the active areas: `{ ids }` with every active area exactly once. Rejects a
 * stale or tampered list without writing anything. Returns the active areas in order.
 */
export async function reorderLifeAreas(input: unknown): Promise<ActionResult<LifeAreaSummary[]>> {
  return reorder(input);
}

/** Archives an area: it leaves the list and stops being offered for new items. */
export async function archiveLifeArea(input: unknown): Promise<ActionResult<LifeAreaSummary>> {
  return archive(input);
}

/**
 * Brings an archived area back: at the end of the list, or where it was with
 * `position: "original"` (undoing an archive).
 */
export async function unarchiveLifeArea(input: unknown): Promise<ActionResult<LifeAreaSummary>> {
  return unarchive(input);
}
