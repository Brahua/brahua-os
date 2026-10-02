// The frequency part of creating (and, from H2, editing) a habit. Client-safe. **Owned by H2**:
// H1 leaves every habit daily; H2 fills these three pieces (schema fields, the columns they
// become, the summary) without touching the files H3 edits (measure-input.ts).
import type { HabitFrequency } from "./habit-constants";

/** H2 slot (Frecuencia): `frequency`, `weeklyTarget` and `weekdays`, optional (daily by default). */
export const frequencyInputShape = {};

/** The columns of the frequency in the input (H1: always daily). */
export function frequencyColumns(input: object): {
  frequency: HabitFrequency;
  weeklyTarget: number | null;
  weekdays: number[] | null;
} {
  void input; // H2 reads it.
  return { frequency: "daily", weeklyTarget: null, weekdays: null };
}

/** The frequency half of the form's live summary ("Cada día", "3 veces por semana"…). */
export function frequencySummary(draft: object): string {
  void draft; // H2 reads it.
  return "Cada día";
}
