"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Key, SectionLabel } from "@/design-system";
import { deleteExercise, updateExercise } from "../exercises-actions";
import { EQUIPMENT_LABELS, EXERCISES_COPY as COPY, GROUP_LABELS } from "../exercises-copy";
import { EXERCISE_FIELDS, updateExerciseInputSchema, type ExerciseItem } from "../exercises-input";
import { HEALTH_COPY } from "../health-copy";
import { DELETED_PARAM, EXERCISES_PATH } from "../routes";
import {
  draftOf,
  errorsByField,
  ExerciseFields,
  fieldId,
  type ExerciseDraft,
  type ExerciseErrors,
} from "./exercise-fields";
import { failureReason, useHealthSave } from "./use-health-save";

type ExerciseDetailProps = {
  exercise: ExerciseItem;
  /** Id of the `<h1>`. */
  headingId: string;
  /** Its records, the best-of line and the history: E3 fills it (SPEC-health "Detalle"). */
  records?: React.ReactNode;
};

/**
 * An exercise's page (SPEC-health "Pantallas"): its data, editable (the same fields as «Nuevo
 * ejercicio»; a name already in use is refused on its field), and «Eliminar» (the catalogue then
 * offers «Deshacer»). One in a live routine can't be deleted nor change between reps and time:
 * the notice names the routine.
 */
export function ExerciseDetail({ exercise, headingId, records = null }: ExerciseDetailProps) {
  const router = useRouter();
  const { send, toaster } = useHealthSave();
  const ids = useId();
  const dataId = useId();
  const [draft, setDraft] = useState<ExerciseDraft>(() => draftOf(exercise));
  const [errors, setErrors] = useState<ExerciseErrors>({});
  const [busy, setBusy] = useState(false);

  function showErrors(next: ExerciseErrors) {
    setErrors(next);
    const first = EXERCISE_FIELDS.find((field) => next[field]);
    if (first) document.getElementById(fieldId(ids, first))?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const input = { id: exercise.id, ...draft };
    const parsed = updateExerciseInputSchema.safeParse(input);
    if (!parsed.success) {
      showErrors(errorsByField(parsed.error.issues));
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await send(() => updateExercise(input));
    setBusy(false);
    if (!result.ok) {
      const refused: ExerciseErrors = {};
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if ((EXERCISE_FIELDS as readonly string[]).includes(field)) {
          refused[field as keyof ExerciseErrors] = messages[0];
        }
      }
      if (Object.keys(refused).length > 0) {
        showErrors(refused);
        return;
      }
      toaster.push({
        title: HEALTH_COPY.notSavedTitle,
        text: `${COPY.notSaved.update} ${failureReason(result)}`,
        tone: "error",
      });
      return;
    }
    setDraft(draftOf(result.data));
    toaster.push({ title: COPY.savedTitle, text: COPY.saved(result.data.name) });
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    const result = await send(() => deleteExercise({ id: exercise.id }));
    if (!result.ok) {
      setBusy(false);
      toaster.push({
        title: HEALTH_COPY.notSavedTitle,
        text: `${COPY.notSaved.delete} ${failureReason(result)}`,
        tone: "error",
      });
      return;
    }
    router.push(`${EXERCISES_PATH}?${DELETED_PARAM}=${exercise.id}`);
  }

  return (
    <article className="flex flex-col gap-8" data-exercise={exercise.id}>
      <header className="flex flex-col gap-1">
        <p className="bo-text-label text-text-secondary">
          {COPY.summary(GROUP_LABELS[exercise.muscleGroup], EQUIPMENT_LABELS[exercise.equipment])}
        </p>
        <h1 id={headingId} tabIndex={-1} className="bo-text-display break-words outline-none">
          {exercise.name}
        </h1>
      </header>

      {records}

      <section aria-labelledby={dataId} className="flex max-w-160 flex-col gap-4">
        <SectionLabel id={dataId} as="h2" title={COPY.dataTitle} />
        <form
          noValidate
          onSubmit={submit}
          className="flex flex-col gap-5"
          data-saving={busy || undefined}
          data-exercise-form=""
        >
          <ExerciseFields
            idPrefix={ids}
            draft={draft}
            errors={errors}
            onChange={(patch, field) => {
              setDraft((current) => ({ ...current, ...patch }));
              setErrors((current) =>
                current[field] ? { ...current, [field]: undefined } : current,
              );
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Key type="submit" variant="signal" aria-disabled={busy || undefined}>
              {HEALTH_COPY.save}
            </Key>
            <Key
              variant="ghost"
              icon={Trash2}
              aria-disabled={busy || undefined}
              data-exercise-delete=""
              onClick={() => void remove()}
            >
              {COPY.deleteExercise}
            </Key>
          </div>
        </form>
      </section>
    </article>
  );
}
