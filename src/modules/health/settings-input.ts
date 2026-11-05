// Validation and client types of «Ajustes» (E4, SPEC-health "Hábito enlazado"). Client-safe.
import { z } from "zod";

/** «Al terminar una sesión, marcar el hábito ___»: a habit's id, or null («Ninguno»). */
export const updateSettingsInputSchema = z.object({ habitId: z.guid().nullable() });

export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>;

/** What the settings sheet shows. */
export type HealthSettingsView = {
  /** The linked habit's id as stored, or null («Ninguno»). */
  habitId: string | null;
  /**
   * The habits a session can mark (`getCheckHabitOptions`: active yes/no habits to build, in
   * their order). A stored `habitId` that isn't among them was deleted, archived or changed its
   * measure: the sheet says «(ya no existe)» and a finished session marks nothing.
   */
  options: { id: string; name: string }[];
};

/** The linked habit's name, or null with none; `missing` when the stored one can't be marked. */
export function linkedHabit(view: HealthSettingsView): { name: string | null; missing: boolean } {
  if (view.habitId === null) return { name: null, missing: false };
  const found = view.options.find((option) => option.id === view.habitId);
  return found ? { name: found.name, missing: false } : { name: null, missing: true };
}
