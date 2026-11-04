"use client";

import { ChevronDown } from "lucide-react";
import { Icon, Switch, TextField } from "@/design-system";
import { cn } from "@/lib/cn";
import { FieldError } from "@/modules/core/components/field-error";
import {
  EQUIPMENT_LABELS,
  EXERCISES_COPY as COPY,
  GROUP_LABELS,
  KIND_LABELS,
} from "../exercises-copy";
import type { ExerciseField, ExerciseItem } from "../exercises-input";
import { formatDuration, restChoices } from "../format";
import {
  DEFAULT_REST_SECONDS,
  EQUIPMENT,
  EXERCISE_KINDS,
  MUSCLE_GROUPS,
  type Equipment,
  type ExerciseKind,
  type MuscleGroup,
} from "../health-constants";

/** What the exercise form holds (the fields as they will be sent). */
export type ExerciseDraft = {
  name: string;
  kind: ExerciseKind;
  muscleGroup: MuscleGroup;
  equipment: Equipment;
  perDumbbell: boolean;
  restSeconds: number;
};

/** A new exercise's fields (with a name typed in a search, say), or an existing one's. */
export function draftOf(exercise: ExerciseItem | null, name = ""): ExerciseDraft {
  if (exercise) {
    const { name: current, kind, muscleGroup, equipment, perDumbbell, restSeconds } = exercise;
    return { name: current, kind, muscleGroup, equipment, perDumbbell, restSeconds };
  }
  return {
    name,
    kind: "weight_reps",
    muscleGroup: "chest",
    equipment: "barbell",
    perDumbbell: false,
    restSeconds: DEFAULT_REST_SECONDS,
  };
}

export type ExerciseErrors = Partial<Record<ExerciseField, string>>;

/** The id of a field's control (`${prefix}-${field}`): the form focuses the first with an error. */
export const fieldId = (prefix: string, field: ExerciseField) => `${prefix}-${field}`;

type ExerciseFieldsProps = {
  idPrefix: string;
  draft: ExerciseDraft;
  errors: ExerciseErrors;
  onChange: (patch: Partial<ExerciseDraft>, field: ExerciseField) => void;
  nameRef?: React.Ref<HTMLInputElement>;
};

/**
 * The fields of an exercise (SPEC-health "Catálogo"): name, how it is measured, group, equipment,
 * «por mancuerna» and the rest. Shared by «Nuevo ejercicio» and the exercise's page.
 */
export function ExerciseFields({
  idPrefix,
  draft,
  errors,
  onChange,
  nameRef,
}: ExerciseFieldsProps) {
  const perDumbbellId = fieldId(idPrefix, "perDumbbell");
  return (
    <>
      <TextField
        ref={nameRef}
        id={fieldId(idPrefix, "name")}
        label={COPY.nameLabel}
        placeholder={COPY.namePlaceholder}
        autoComplete="off"
        value={draft.name}
        error={errors.name}
        data-exercise-name=""
        onChange={(event) => onChange({ name: event.target.value }, "name")}
      />
      <Select
        id={fieldId(idPrefix, "kind")}
        label={COPY.kindLabel}
        value={draft.kind}
        error={errors.kind}
        options={EXERCISE_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))}
        onChange={(value) => onChange({ kind: value as ExerciseKind }, "kind")}
      />
      <Select
        id={fieldId(idPrefix, "muscleGroup")}
        label={COPY.groupLabel}
        value={draft.muscleGroup}
        error={errors.muscleGroup}
        options={MUSCLE_GROUPS.map((value) => ({ value, label: GROUP_LABELS[value] }))}
        onChange={(value) => onChange({ muscleGroup: value as MuscleGroup }, "muscleGroup")}
      />
      <Select
        id={fieldId(idPrefix, "equipment")}
        label={COPY.equipmentLabel}
        value={draft.equipment}
        error={errors.equipment}
        options={EQUIPMENT.map((value) => ({ value, label: EQUIPMENT_LABELS[value] }))}
        onChange={(value) => onChange({ equipment: value as Equipment }, "equipment")}
      />
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span id={`${perDumbbellId}-label`} className="bo-field__label">
            {COPY.perDumbbellLabel}
          </span>
          <span id={`${perDumbbellId}-help`} className="bo-field__help">
            {COPY.perDumbbellHelp}
          </span>
          {errors.perDumbbell ? (
            <FieldError id={`${perDumbbellId}-error`} message={errors.perDumbbell} />
          ) : null}
        </div>
        <Switch
          id={perDumbbellId}
          checked={draft.perDumbbell}
          aria-labelledby={`${perDumbbellId}-label`}
          aria-describedby={`${perDumbbellId}-help`}
          data-exercise-per-dumbbell=""
          onCheckedChange={(next) => onChange({ perDumbbell: next }, "perDumbbell")}
        />
      </div>
      <Select
        id={fieldId(idPrefix, "restSeconds")}
        label={COPY.restLabel}
        help={COPY.restHelp}
        value={String(draft.restSeconds)}
        error={errors.restSeconds}
        options={restChoices(draft.restSeconds).map((seconds) => ({
          value: String(seconds),
          label: formatDuration(seconds),
        }))}
        onChange={(value) => onChange({ restSeconds: Number(value) }, "restSeconds")}
      />
    </>
  );
}

/** A native select in the design system's field (as `learning`'s forms). */
export function Select({
  id,
  label,
  help,
  value,
  error,
  options,
  onChange,
  describedBy: extra,
}: {
  id: string;
  label: string;
  help?: string;
  value: string;
  error?: string;
  /** Another element that describes it too (read before its own help or error). */
  describedBy?: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const own = error ? `${id}-error` : help ? `${id}-help` : undefined;
  const describedBy = [extra, own].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("bo-field", error && "is-error")}>
      <label className="bo-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="bo-select">
        <select
          id={id}
          className="bo-field__control"
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
      </div>
      {error ? (
        <FieldError id={`${id}-error`} message={error} />
      ) : help ? (
        <span id={`${id}-help`} className="bo-field__help">
          {help}
        </span>
      ) : null}
    </div>
  );
}

/** Errors of a failed parse or a refused save, by field (the first message of each). */
export function errorsByField(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): ExerciseErrors {
  const errors: ExerciseErrors = {};
  for (const issue of issues) {
    const field = issue.path[0] as ExerciseField;
    errors[field] ??= issue.message;
  }
  return errors;
}
