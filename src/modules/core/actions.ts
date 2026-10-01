"use server";

// Server Actions of `core`. Each one goes through ownerAction(): owner check first, Zod, then an
// ActionResult (SPEC-core "Estilo de código"). Reachable by any POST, so input is `unknown`.
import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { ownerAction } from "@/lib/owner-action";
import {
  LIFE_AREA_ERRORS,
  lifeAreaInputSchema,
  updateLifeAreaInputSchema,
  type LifeAreaSummary,
} from "./life-area-input";
import { insertLifeArea, updateLifeAreaById } from "./life-areas";
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
    if (!area) return fail(LIFE_AREA_ERRORS.id);
    revalidatePath(AREAS_PATH);
    return ok(area);
  },
  { name: "updateLifeArea" },
);

/** Creates a life area at the end of the list. */
export async function createLifeArea(input: unknown): Promise<ActionResult<LifeAreaSummary>> {
  return create(input);
}

/** Changes an area's name, color and icon. Its slug and position stay as they are. */
export async function updateLifeArea(input: unknown): Promise<ActionResult<LifeAreaSummary>> {
  return update(input);
}
