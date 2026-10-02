"use client";

import { Repeat2 } from "lucide-react";
import { useEffect, useId, useImperativeHandle, useRef } from "react";
import { Key, SegmentedControl, TextField } from "@/design-system";
import { cn } from "@/lib/cn";
import { FieldError } from "@/modules/core/components/field-error";
import type { HabitKind, HabitMeasure } from "../habit-constants";
import type { HabitItem } from "../habit-input";
import { MEASURE_COPY } from "../measure-copy";
import {
  SEVERAL_TIMES_DEFAULT_GOAL,
  SEVERAL_TIMES_UNIT,
  type MeasureDraft,
} from "../measure-input";

/** The kind and measure as the form holds them (numbers as typed). */
export type MeasureFormValue = {
  kind: HabitKind;
  measure: HabitMeasure;
  goal: string;
  unit: string;
  step: string;
};

/** A new habit: a yes/no to keep. */
export const EMPTY_MEASURE: MeasureFormValue = {
  kind: "build",
  measure: "check",
  goal: "",
  unit: "",
  step: "1",
};

/** The form's value: a new habit's (a yes/no to keep), or an edited habit's own. */
export function measureFormValueOf(habit?: HabitItem | null): MeasureFormValue {
  if (!habit) return EMPTY_MEASURE;
  const quantity = habit.measure === "quantity";
  return {
    kind: habit.kind,
    measure: habit.measure,
    goal: quantity ? String(habit.goal) : "",
    unit: quantity ? (habit.unit ?? "") : "",
    step: String(habit.step),
  };
}

/** A typed number for the schema: blank is "not given", anything else as typed (NaN refused). */
function typedNumber(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

/**
 * What the form sends of the kind and measure (and validates with `createHabitInputSchema`):
 * a quantity's goal, unit and step only while "Cantidad" is picked for a habit to keep.
 */
export function measureDraft(value: MeasureFormValue): MeasureDraft & {
  kind: HabitKind;
  measure: HabitMeasure;
} {
  if (value.kind === "avoid") return { kind: "avoid", measure: "check" };
  if (value.measure !== "quantity") return { kind: value.kind, measure: "check" };
  return {
    kind: value.kind,
    measure: "quantity",
    goal: typedNumber(value.goal),
    unit: value.unit,
    step: typedNumber(value.step),
  };
}

/**
 * What an edit sends of the measure (`updateHabitInputSchema`): a quantity's goal, unit and step
 * (the kind and the measure never change in an edit); nothing for a yes/no.
 */
export function measureEditValues(value: MeasureFormValue): {
  goal?: number;
  unit?: string;
  step?: number;
} {
  if (value.kind === "avoid" || value.measure !== "quantity") return {};
  return { goal: typedNumber(value.goal), unit: value.unit, step: typedNumber(value.step) };
}

/** An `aria-describedby` from the ids that apply (undefined when none does). */
function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const present = ids.filter(Boolean);
  return present.length > 0 ? present.join(" ") : undefined;
}

type MeasureField = "kind" | "measure" | "goal" | "unit" | "step";

export type MeasureFieldsHandle = {
  /** Focus a field (the first invalid one after a failed submit). */
  focus: (field: string) => void;
};

type MeasureFieldsProps = {
  ref?: React.Ref<MeasureFieldsHandle>;
  value: MeasureFormValue;
  onChange: (value: MeasureFormValue) => void;
  errors: Partial<Record<string, string>>;
  /** A field was edited (its error, if any, clears). */
  onEdit: (field: MeasureField) => void;
  /**
   * Editing a habit: its kind and measure stay as they are (shown as a note); a quantity's goal,
   * unit and step can change.
   */
  editing?: boolean;
  /** "Varias veces al día" was picked: the form makes the habit daily too. */
  onSeveralTimes?: () => void;
};

/**
 * The create form's "Tipo" and "Medición" (SPEC-habits "Crear y editar"): "A cumplir · A evitar"
 * (a habit to avoid is a yes/no, every day), "Sí/No · Cantidad" with the goal, unit and step, and
 * the "Varias veces al día" shortcut (a daily quantity in "veces", goal N, step 1).
 */
export function MeasureFields({
  ref,
  value,
  onChange,
  errors,
  onEdit,
  editing = false,
  onSeveralTimes,
}: MeasureFieldsProps) {
  const ids = useId();
  const kindGroup = useRef<HTMLDivElement>(null);
  const measureGroup = useRef<HTMLDivElement>(null);
  const goalInput = useRef<HTMLInputElement>(null);
  const unitInput = useRef<HTMLInputElement>(null);
  const stepInput = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus(field) {
      const group = field === "kind" ? kindGroup : field === "measure" ? measureGroup : null;
      if (group) {
        group.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
        return;
      }
      const input =
        field === "goal"
          ? goalInput
          : field === "unit"
            ? unitInput
            : field === "step"
              ? stepInput
              : null;
      input?.current?.focus();
    },
  }));

  function set<K extends keyof MeasureFormValue>(field: K, next: MeasureFormValue[K]) {
    onChange({ ...value, [field]: next });
    onEdit(field);
  }

  // The goal is what is left to decide after the shortcut ("2 veces", "3 veces…"): selected once
  // it renders.
  const selectGoal = useRef(false);
  useEffect(() => {
    if (!selectGoal.current) return;
    selectGoal.current = false;
    goalInput.current?.select();
  });

  /** "Varias veces al día": a quantity in "veces", one per tap; the goal stays editable. */
  function severalTimes() {
    onChange({
      ...value,
      kind: "build",
      measure: "quantity",
      unit: SEVERAL_TIMES_UNIT,
      step: "1",
      goal: value.goal.trim() === "" ? String(SEVERAL_TIMES_DEFAULT_GOAL) : value.goal,
    });
    for (const field of ["measure", "goal", "unit", "step"] as const) onEdit(field);
    onSeveralTimes?.();
    selectGoal.current = true;
  }

  const kindLabelId = `${ids}-kind-label`;
  const kindErrorId = `${ids}-kind-error`;
  const avoidNoteId = `${ids}-avoid-note`;
  const measureLabelId = `${ids}-measure-label`;
  const measureErrorId = `${ids}-measure-error`;
  const severalHelpId = `${ids}-several-help`;
  const avoid = value.kind === "avoid";
  const quantity = !avoid && value.measure === "quantity";

  const quantityFields = (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
      <TextField
        ref={goalInput}
        label={MEASURE_COPY.goalLabel}
        name="goal"
        inputMode="numeric"
        autoComplete="off"
        value={value.goal}
        error={errors.goal}
        help={editing ? MEASURE_COPY.goalEditHelp : undefined}
        id={`${ids}-goal`}
        onChange={(event) => set("goal", event.target.value)}
      />
      <TextField
        ref={stepInput}
        label={MEASURE_COPY.stepLabel}
        name="step"
        inputMode="numeric"
        autoComplete="off"
        value={value.step}
        error={errors.step}
        help={MEASURE_COPY.stepHelp}
        id={`${ids}-step`}
        onChange={(event) => set("step", event.target.value)}
      />
      <TextField
        ref={unitInput}
        className="col-span-2"
        label={MEASURE_COPY.unitLabel}
        name="unit"
        autoComplete="off"
        value={value.unit}
        error={errors.unit}
        help={MEASURE_COPY.unitHelp}
        id={`${ids}-unit`}
        onChange={(event) => set("unit", event.target.value)}
      />
    </div>
  );

  // Editing: the kind and measure stay (SPEC-habits "Cambiar … medición"); a note says what it
  // is, and a quantity keeps its goal, step and unit fields.
  if (editing) {
    return (
      <>
        <p className="bo-text-body-sm text-text-secondary" data-measure-note="">
          {avoid
            ? MEASURE_COPY.avoidNote
            : quantity
              ? MEASURE_COPY.editQuantityNote
              : MEASURE_COPY.editCheckNote}
        </p>
        {quantity ? quantityFields : null}
      </>
    );
  }

  return (
    <>
      <div className={cn("bo-field", errors.kind && "is-error")}>
        <span id={kindLabelId} className="bo-field__label">
          {MEASURE_COPY.kindLabel}
        </span>
        <SegmentedControl
          ref={kindGroup}
          mode="radio"
          touch
          label={MEASURE_COPY.kindLabel}
          aria-labelledby={kindLabelId}
          aria-describedby={describedBy(errors.kind && kindErrorId, avoid && avoidNoteId)}
          aria-invalid={errors.kind ? true : undefined}
          options={[
            { value: "build", label: MEASURE_COPY.kindBuild },
            { value: "avoid", label: MEASURE_COPY.kindAvoid },
          ]}
          value={value.kind}
          onValueChange={(next) => set("kind", next)}
        />
        {errors.kind ? <FieldError id={kindErrorId} message={errors.kind} /> : null}
        {avoid ? (
          <span id={avoidNoteId} className="bo-field__help">
            {MEASURE_COPY.avoidNote}
          </span>
        ) : null}
      </div>

      {avoid ? null : (
        <div className={cn("bo-field", errors.measure && "is-error")}>
          <span id={measureLabelId} className="bo-field__label">
            {MEASURE_COPY.measureLabel}
          </span>
          <SegmentedControl
            ref={measureGroup}
            mode="radio"
            touch
            label={MEASURE_COPY.measureLabel}
            aria-labelledby={measureLabelId}
            aria-describedby={describedBy(errors.measure && measureErrorId)}
            aria-invalid={errors.measure ? true : undefined}
            options={[
              { value: "check", label: MEASURE_COPY.measureCheck },
              { value: "quantity", label: MEASURE_COPY.measureQuantity },
            ]}
            value={value.measure}
            onValueChange={(next) => set("measure", next)}
          />
          {errors.measure ? <FieldError id={measureErrorId} message={errors.measure} /> : null}
          <div className="mt-1 flex flex-col items-start gap-1">
            <Key
              variant="ghost"
              size="md"
              icon={Repeat2}
              aria-describedby={severalHelpId}
              onClick={severalTimes}
            >
              {MEASURE_COPY.severalTimes}
            </Key>
            <span id={severalHelpId} className="bo-field__help">
              {MEASURE_COPY.severalTimesHelp}
            </span>
          </div>
        </div>
      )}

      {quantity ? quantityFields : null}
    </>
  );
}
