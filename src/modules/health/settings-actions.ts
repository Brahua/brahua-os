"use server";

// Server Action of «Ajustes» (E4): the linked habit. Through ownerAction(): owner check first, Zod,
// then an ActionResult. Revalidates /health either way (the line under «Ajustes» says the habit
// as stored; after a refusal, the sheet's list is read again).
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getDb } from "@/lib/db";
import { ownerAction } from "@/lib/owner-action";
import { revalidateHealth } from "./revalidate";
import { upsertSettings } from "./settings";
import { SETTINGS_ERRORS } from "./settings-copy";
import { updateSettingsInputSchema, type HealthSettingsView } from "./settings-input";

const update = ownerAction(
  updateSettingsInputSchema,
  async (data) => {
    const result = await upsertSettings(getDb(), data);
    revalidateHealth();
    return result === "habitUnavailable" ? fail(SETTINGS_ERRORS.habitUnavailable) : ok(result);
  },
  { name: "updateHealthSettings" },
);

/** «Al terminar una sesión, marcar el hábito ___»: a habit's id, or null («Ninguno»). */
export async function updateHealthSettings(
  input: unknown,
): Promise<ActionResult<HealthSettingsView>> {
  return update(input);
}
