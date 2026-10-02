"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AREA_ICONS, Icon, Key, Led, Sheet, TextField } from "@/design-system";
import { fail, type ActionResult, type FieldErrors } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { FieldError } from "@/modules/core/components/field-error";
import {
  focusRadioGrid,
  RadioGrid,
  type RadioGridOption,
} from "@/modules/core/components/radio-grid";
import { createHabit } from "../actions";
import {
  CREATE_HABIT_FIELDS,
  createHabitInputSchema,
  type CreateHabitField,
  type HabitAreaSummary,
  type HabitItem,
} from "../habit-input";
import { HABITS_COPY } from "../habits-copy";

/** The area picker's value for "Sin área". */
const NO_AREA = "";

type Errors = Partial<Record<CreateHabitField, string>>;

function firstErrors(fieldErrors: FieldErrors | undefined): Errors {
  const errors: Errors = {};
  for (const field of CREATE_HABIT_FIELDS) {
    const message = fieldErrors?.[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

/**
 * The live summary under the form ("Cada día · Sí o no"). H1: every habit is a daily yes/no.
 * H2 slot (Frecuencia) and H3 slot (Medición): build it from the draft ("3 veces por semana ·
 * 8 vasos").
 */
function ruleSummary(): string {
  return HABITS_COPY.summaryDailyCheck;
}

export type HabitFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active life areas, in their order: the only ones a new habit can go in. */
  areas: readonly HabitAreaSummary[];
  /** Where focus goes if the sheet closes without creating (the key that opened it). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** The habit was created: the screen closes the sheet and focuses its pad. */
  onCreated: (habit: HabitItem) => void;
  /** Called once the sheet has fully closed (see `Sheet`). */
  onClosed?: () => void;
};

/**
 * "Nuevo hábito" (SPEC-habits "Crear y editar"): the name (focused) and an optional area. H2 and
 * H3 fill their slots (frequency; kind and measure) and "Más detalles". Validates on the client
 * with the action's own schema; the Server Action validates again (the authority). Not
 * optimistic: it waits for the server ("Creando…"), and the sheet stays open meanwhile.
 */
export function HabitFormSheet({
  open,
  onOpenChange,
  areas,
  returnFocusRef,
  onCreated,
  onClosed,
}: HabitFormSheetProps) {
  const isDesktop = useIsDesktop();
  const [name, setName] = useState("");
  const [pickedAreaId, setLifeAreaId] = useState<string>(NO_AREA);
  // Only an area that is still offered counts as picked: after "areaUnavailable" the page
  // brings the current areas, and an archived one drops out of the selection by itself.
  const lifeAreaId = areas.some((area) => area.id === pickedAreaId) ? pickedAreaId : NO_AREA;
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Set by a failed submit; the next commit moves focus to the first invalid field.
  const focusFirstInvalid = useRef(false);

  const ids = useId();
  const formId = `${ids}-form`;
  const nameInput = useRef<HTMLInputElement>(null);
  const areaGroup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusFirstInvalid.current) return;
    focusFirstInvalid.current = false;
    const first = CREATE_HABIT_FIELDS.find((field) => errors[field]);
    if (first === "name") nameInput.current?.focus();
    else if (first === "lifeAreaId") focusRadioGrid(areaGroup.current);
  });

  // While saving, the sheet stays open: Esc, the scrim, ✕ and Cancelar do nothing.
  function requestOpenChange(next: boolean) {
    if (!next && pending) return;
    onOpenChange(next);
  }

  function showErrors(result: { error: string; fieldErrors?: FieldErrors }) {
    const fieldErrors = firstErrors(result.fieldErrors);
    focusFirstInvalid.current = true;
    setErrors(fieldErrors);
    const other = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
    setFormError(Object.keys(fieldErrors).length > 0 ? null : (other ?? result.error));
  }

  function clearError(field: CreateHabitField) {
    setErrors((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = createHabitInputSchema.safeParse({ name, lifeAreaId });
    if (!parsed.success) {
      const failed = fail(parsed.error);
      if (!failed.ok) showErrors(failed);
      return;
    }
    setFormError(null);
    startTransition(async () => {
      let result: ActionResult<HabitItem>;
      try {
        result = await createHabit(parsed.data);
      } catch {
        // Network failure or a new deployment: the action itself never throws.
        result = fail(HABITS_COPY.unexpected);
      }
      if (!result.ok) {
        showErrors(result);
        return;
      }
      onCreated(result.data);
    });
  }

  const areaOptions: RadioGridOption<string>[] = [
    {
      value: NO_AREA,
      label: HABITS_COPY.noArea,
      children: <span className="bo-option-key__label">{HABITS_COPY.noArea}</span>,
    },
    ...areas.map((area) => ({
      value: area.id,
      label: area.name,
      children: (
        <>
          <Led area={area.color} size="sm" />
          <Icon icon={AREA_ICONS[area.icon]} size="sm" />
          {/* Up to two lines: long area names stay readable on the phone. */}
          <span className="bo-option-key__label" title={area.name}>
            {area.name}
          </span>
        </>
      ),
    })),
  ];

  const areaLabelId = `${ids}-area-label`;
  const areaHintId = `${ids}-area-hint`;
  const areaErrorId = `${ids}-area-error`;
  const summaryId = `${ids}-summary`;

  return (
    <Sheet
      open={open}
      onOpenChange={requestOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={HABITS_COPY.newHabit}
      returnFocusRef={returnFocusRef}
      onClosed={onClosed}
      closeDisabled={pending}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={pending || undefined}
            onClick={() => requestOpenChange(false)}
          >
            {HABITS_COPY.cancel}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={pending || undefined}
            aria-describedby={summaryId}
          >
            {pending ? HABITS_COPY.creating : HABITS_COPY.create}
          </Key>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-6">
        <TextField
          ref={nameInput}
          label={HABITS_COPY.nameLabel}
          name="name"
          value={name}
          autoComplete="off"
          autoFocus
          required
          error={errors.name}
          help={HABITS_COPY.nameHelp}
          id={`${ids}-name`}
          onChange={(event) => {
            setName(event.target.value);
            if (errors.name) clearError("name");
          }}
        />

        {/* H3 slot (Tipo y Medición): SegmentedControl "A cumplir · A evitar" and "Sí/No ·
            Cantidad" (meta, unidad y paso). Its fields go in createHabitInputSchema. */}

        {/* H2 slot (Frecuencia): "Diaria · Por semana · Días fijos" and "Varias veces al día". */}

        <div className={cn("bo-field", errors.lifeAreaId && "is-error")}>
          <span id={areaLabelId} className="bo-field__label">
            {HABITS_COPY.areaLabel}
          </span>
          <RadioGrid
            ref={areaGroup}
            options={areaOptions}
            value={lifeAreaId}
            onValueChange={(value) => {
              setLifeAreaId(value);
              if (errors.lifeAreaId) clearError("lifeAreaId");
            }}
            labelledBy={areaLabelId}
            describedBy={errors.lifeAreaId ? `${areaHintId} ${areaErrorId}` : areaHintId}
            errorId={errors.lifeAreaId ? areaErrorId : undefined}
            invalid={Boolean(errors.lifeAreaId)}
            className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2"
            itemClassName="bo-option-key min-w-0"
          />
          <span id={areaHintId} className="bo-field__help">
            {HABITS_COPY.areaHint}
          </span>
          {errors.lifeAreaId ? <FieldError id={areaErrorId} message={errors.lifeAreaId} /> : null}
        </div>

        {/* "Más detalles" slot: identity, cue and start date (not assigned to H2–H5 yet). */}

        <p className="bo-text-body-sm text-text-secondary">
          <span className="bo-text-label">{HABITS_COPY.summaryLabel}: </span>
          <span id={summaryId}>{ruleSummary()}</span>
        </p>

        {formError ? (
          <p role="alert" className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {formError}
          </p>
        ) : null}
        {/* The key's text changes too, but a screen reader on another control wouldn't hear it. */}
        <p role="status" className="sr-only">
          {pending ? HABITS_COPY.creatingStatus : ""}
        </p>
      </form>
    </Sheet>
  );
}
