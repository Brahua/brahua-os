"use client";

import { useId, useRef, useState } from "react";
import { Key, Sheet } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { createExercise } from "../exercises-actions";
import { EXERCISES_COPY as COPY } from "../exercises-copy";
import { createExerciseInputSchema, EXERCISE_FIELDS, type ExerciseItem } from "../exercises-input";
import { HEALTH_COPY } from "../health-copy";
import {
  draftOf,
  errorsByField,
  ExerciseFields,
  fieldId,
  type ExerciseDraft,
  type ExerciseErrors,
} from "./exercise-fields";
import { useHealthSave } from "./use-health-save";

type ExerciseFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The key that opened it: focus comes back here. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** The name it starts with (what was typed in a search), if any. */
  initialName?: string;
  onCreated: (exercise: ExerciseItem) => void;
  /** After the sheet fully closed (announce here: the page is no longer aria-hidden). */
  onClosed?: () => void;
};

/**
 * «Nuevo ejercicio» (SPEC-health "Catálogo"), from the catalogue and from a routine's picker. The
 * same sheet the other modules use (bottom on the phone, side panel on the desktop): it stays open
 * with the error on its field when the save is refused («Ya existe un ejercicio con ese nombre»).
 * Mount it with a new `key` on each opening (its fields start from props).
 */
export function ExerciseFormSheet({
  open,
  onOpenChange,
  returnFocusRef,
  initialName = "",
  onCreated,
  onClosed,
}: ExerciseFormSheetProps) {
  const isDesktop = useIsDesktop();
  const { send } = useHealthSave();
  const ids = useId();
  const formId = `${ids}-form`;
  const nameInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<ExerciseDraft>(() => draftOf(null, initialName));
  const [errors, setErrors] = useState<ExerciseErrors>({});
  const [saving, setSaving] = useState(false);

  function showErrors(next: ExerciseErrors) {
    setErrors(next);
    const first = EXERCISE_FIELDS.find((field) => next[field]);
    if (first) document.getElementById(fieldId(ids, first))?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsed = createExerciseInputSchema.safeParse(draft);
    if (!parsed.success) {
      showErrors(errorsByField(parsed.error.issues));
      return;
    }
    setErrors({});
    setSaving(true);
    const result = await send(() => createExercise(draft));
    setSaving(false);
    if (!result.ok) {
      const refused: ExerciseErrors = {};
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if ((EXERCISE_FIELDS as readonly string[]).includes(field)) {
          refused[field as keyof ExerciseErrors] = messages[0];
        }
      }
      if (Object.keys(refused).length === 0) refused.name = result.error;
      showErrors(refused);
      return;
    }
    onCreated(result.data);
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
      variant={isDesktop ? "side" : "bottom"}
      title={COPY.newSheetTitle}
      returnFocusRef={returnFocusRef}
      initialFocusRef={isDesktop ? nameInput : undefined}
      focusTitleOnOpen={!isDesktop}
      closeDisabled={saving}
      onClosed={onClosed}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={saving || undefined}
            onClick={() => {
              if (!saving) onOpenChange(false);
            }}
          >
            {HEALTH_COPY.cancel}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={saving || undefined}
            data-exercise-form-submit=""
          >
            {COPY.create}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-5"
        data-saving={saving || undefined}
      >
        <ExerciseFields
          idPrefix={ids}
          draft={draft}
          errors={errors}
          nameRef={nameInput}
          onChange={(patch, field) => {
            setDraft((current) => ({ ...current, ...patch }));
            setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
          }}
        />
      </form>
    </Sheet>
  );
}
