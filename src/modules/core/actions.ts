"use server";

// Server Actions of `core` (SPEC-core "Estilo de código"): each one checks the owner first,
// validates with Zod and returns an ActionResult. Reachable by any POST, so nothing here trusts
// the caller: input is `unknown` until parsed.
import { revalidatePath } from "next/cache";
import { fail, ok, unauthorized, type ActionResult } from "@/lib/action-result";
import { requireOwnerAction } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  LIFE_AREA_ERRORS,
  lifeAreaInputSchema,
  updateLifeAreaInputSchema,
} from "./life-area-input";
import { insertLifeArea, updateLifeAreaById, type LifeAreaSummary } from "./life-areas";

const AREAS_PATH = "/areas";

/** Creates a life area at the end of the list. */
export async function createLifeArea(input: unknown): Promise<ActionResult<LifeAreaSummary>> {
  if (!(await requireOwnerAction())) return unauthorized();
  const parsed = lifeAreaInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error);

  const area = await insertLifeArea(getDb(), parsed.data);
  revalidatePath(AREAS_PATH);
  return ok(area);
}

/** Changes an area's name, color and icon. Its slug and position stay as they are. */
export async function updateLifeArea(input: unknown): Promise<ActionResult<LifeAreaSummary>> {
  if (!(await requireOwnerAction())) return unauthorized();
  const parsed = updateLifeAreaInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error);

  const area = await updateLifeAreaById(getDb(), parsed.data);
  if (!area) return fail(LIFE_AREA_ERRORS.id);
  revalidatePath(AREAS_PATH);
  return ok(area);
}
