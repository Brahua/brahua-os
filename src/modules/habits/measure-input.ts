// The kind and measure part of creating (and editing) a habit. Client-safe. **Owned by H3**: H1
// leaves every habit a yes/no to keep; H3 fills these three pieces (schema fields, the columns
// they become, the summary) without touching the files H2 edits (frequency-input.ts). The cross
// rule "a evitar ⇒ sí/no diario" needs both halves: H3 adds it (after H2 is merged) as a
// superRefine on `createHabitInputSchema`.
import type { HabitKind, HabitMeasure } from "./habit-constants";

/** H3 slot (Tipo y Medición): `kind`, `measure`, `goal`, `unit` and `step`, optional. */
export const measureInputShape = {};

/** The columns of the kind and measure in the input (H1: always a yes/no habit to keep). */
export function measureColumns(input: object): {
  kind: HabitKind;
  measure: HabitMeasure;
  goal: number;
  unit: string | null;
  step: number;
} {
  void input; // H3 reads it.
  return { kind: "build", measure: "check", goal: 1, unit: null, step: 1 };
}

/** The measure half of the form's live summary ("Sí o no", "8 vasos"…). */
export function measureSummary(draft: object): string {
  void draft; // H3 reads it.
  return "Sí o no";
}
