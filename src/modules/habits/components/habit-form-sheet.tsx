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
import { startDateError } from "../details-input";
import { frequencySummary } from "../frequency-input";
import { measureSummary } from "../measure-input";
import {
  CREATE_HABIT_FIELDS,
  createHabitInputSchema,
  updateHabitInputSchema,
  type CreateHabitField,
  type HabitAreaSummary,
  type HabitItem,
} from "../habit-input";
import { HABITS_COPY } from "../habits-copy";
import { updateHabit } from "../organize-actions";
import { ORGANIZE_COPY } from "../organize-copy";
import {
  FrequencyField,
  focusFrequencyField,
  frequencyDraftOf,
  frequencyValues,
} from "./frequency-field";
import {
  DetailsFields,
  detailsDraftOf,
  detailsValues,
  type DetailsFieldsHandle,
} from "./details-fields";
import {
  ReminderFields,
  reminderDraftOf,
  reminderValues,
  type ReminderFieldsHandle,
} from "./reminder-fields";
import {
  MeasureFields,
  measureDraft,
  measureEditValues,
  measureFormValueOf,
  type MeasureFieldsHandle,
  type MeasureFormValue,
} from "./measure-fields";

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
 * The live summary under the form ("Cada día · Sí o no"): each half comes from the file its task
 * owns (H2 frequency-input.ts, H3 measure-input.ts), built from the draft.
 */
function ruleSummary(draft: object): string {
  return `${frequencySummary(draft)} · ${measureSummary(draft)}`;
}

export type HabitFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active life areas, in their order: the only ones a new habit can go in. */
  areas: readonly HabitAreaSummary[];
  /** Where focus goes if the sheet closes without creating (the key that opened it). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** H2: the habit to edit (the form starts from it and saves with `updateHabit`). */
  habit?: HabitItem | null;
  /** H5: Lima's today (the screen's): the start date's default and window. */
  today: string;
  /** Created (or, editing, saved): the screen closes the sheet and focuses its pad. */
  onCreated: (habit: HabitItem) => void;
  /** Called once the sheet has fully closed (see `Sheet`). */
  onClosed?: () => void;
};

/**
 * "Nuevo hábito" and, with `habit`, "Editar hábito" (SPEC-habits "Crear y editar"): the name
 * (focused), the frequency (H2) and an optional area. H3 fills its slot (kind and measure) and
 * "Más detalles". Validates on the client with the action's own schema; the Server Action
 * validates again (the authority). Not optimistic: it waits for the server ("Creando…",
 * "Guardando…"), and the sheet stays open meanwhile.
 */
export function HabitFormSheet({
  open,
  onOpenChange,
  areas: activeAreas,
  returnFocusRef,
  habit = null,
  today,
  onCreated,
  onClosed,
}: HabitFormSheetProps) {
  const isDesktop = useIsDesktop();
  const editing = habit !== null;
  // Editing a habit whose area was archived since: that area stays offered (and picked), so
  // saving never drops it by accident (SPEC-habits "Área": it is kept).
  const keptArea =
    habit?.area && !activeAreas.some((area) => area.id === habit.area?.id) ? habit.area : null;
  const areas = keptArea ? [...activeAreas, keptArea] : activeAreas;
  const [name, setName] = useState(habit?.name ?? "");
  const [pickedAreaId, setLifeAreaId] = useState<string>(habit?.area?.id ?? NO_AREA);
  const [frequency, setFrequency] = useState(() => frequencyDraftOf(habit));
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
  const frequencyGroup = useRef<HTMLDivElement>(null);
  // H3: kind and measure (and a quantity's goal, unit and step), as typed. Editing starts from
  // the habit; its kind and measure don't change there (only a quantity's goal, unit and step).
  const [measure, setMeasure] = useState<MeasureFormValue>(() => measureFormValueOf(habit));
  const measureFields = useRef<MeasureFieldsHandle>(null);
  // A habit to avoid is daily: its frequency isn't asked (and is sent as daily).
  const avoid = measure.kind === "avoid";
  const sentFrequency = frequencyValues(avoid ? frequencyDraftOf(null) : frequency);
  const measureValues = habit ? measureEditValues(measure) : measureDraft(measure);
  // H5: "Más detalles" (identity, cue and, creating, the start date).
  const [details, setDetails] = useState(() => detailsDraftOf(habit, today));
  const detailsFields = useRef<DetailsFieldsHandle>(null);
  // R4: "Hora del aviso" (not for a habit to avoid) and "Franja".
  const [reminder, setReminder] = useState(() => reminderDraftOf(habit));
  const reminderFields = useRef<ReminderFieldsHandle>(null);

  useEffect(() => {
    if (!focusFirstInvalid.current) return;
    focusFirstInvalid.current = false;
    const first = CREATE_HABIT_FIELDS.find((field) => errors[field]);
    if (first === "name") nameInput.current?.focus();
    else if (first === "lifeAreaId") focusRadioGrid(areaGroup.current);
    else if (first === "frequency" || first === "weeklyTarget" || first === "weekdays") {
      focusFrequencyField(frequencyGroup.current, first);
    } else if (first === "reminderTime" || first === "daypart") {
      reminderFields.current?.focus(first);
    } else if (first === "identity" || first === "cue" || first === "startDate") {
      detailsFields.current?.focus(first);
    } else if (first) measureFields.current?.focus(first);
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
    const values = {
      name,
      lifeAreaId,
      ...sentFrequency,
      ...measureValues,
      ...detailsValues(details, habit, today),
      ...reminderValues(reminder, habit, !avoid),
    };
    const parsed = habit
      ? updateHabitInputSchema.safeParse({ id: habit.id, ...values })
      : createHabitInputSchema.safeParse(values);
    if (!parsed.success) {
      const failed = fail(parsed.error);
      if (!failed.ok) showErrors(failed);
      return;
    }
    // H5: a new habit starts today or up to 7 days back (the server checks it again).
    // (Blank is today.)
    const startError =
      editing || !details.startDate ? null : startDateError(details.startDate, today);
    if (startError) {
      showErrors({ error: startError, fieldErrors: { startDate: [startError] } });
      return;
    }
    setFormError(null);
    startTransition(async () => {
      let result: ActionResult<HabitItem>;
      try {
        result = await (habit ? updateHabit(parsed.data) : createHabit(parsed.data));
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
    ...areas.map((area) => {
      const label = area.id === keptArea?.id ? ORGANIZE_COPY.archivedArea(area.name) : area.name;
      return {
        value: area.id,
        label,
        children: (
          <>
            <Led area={area.color} size="sm" />
            <Icon icon={AREA_ICONS[area.icon]} size="sm" />
            {/* Up to two lines: long area names stay readable on the phone. */}
            <span className="bo-option-key__label" title={label}>
              {label}
            </span>
          </>
        ),
      };
    }),
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
      title={editing ? ORGANIZE_COPY.editHabit : HABITS_COPY.newHabit}
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
            {editing
              ? pending
                ? ORGANIZE_COPY.saving
                : ORGANIZE_COPY.save
              : pending
                ? HABITS_COPY.creating
                : HABITS_COPY.create}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-6"
        // E2E `afterSaveSettled` waits for this while the create is in flight.
        data-saving={pending ? "" : undefined}
      >
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
          // R4: the time field is a second field that blocks implicit submission (the submit key
          // is in the footer, outside the form's markup), so Enter in «Nombre» submits by hand.
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />

        {/* H3 (Tipo y Medición): its fields go in createHabitInputSchema (measure-input.ts). */}
        <MeasureFields
          ref={measureFields}
          value={measure}
          onChange={setMeasure}
          errors={errors}
          editing={Boolean(habit)}
          onEdit={(field) => {
            if (errors[field]) clearError(field);
          }}
          // "Varias veces al día" is a daily habit.
          onSeveralTimes={() => setFrequency((draft) => ({ ...draft, frequency: "daily" }))}
        />

        {/* H2 (Frecuencia): "Diaria · Por semana · Días fijos", with X or the days. ("Varias
            veces al día" is H3's shortcut: a daily quantity habit.) */}
        {/* H3: a habit to avoid is daily (its note says so), so no frequency to pick. */}
        {avoid ? null : (
          <FrequencyField
            ref={frequencyGroup}
            id={`${ids}-frequency`}
            draft={frequency}
            onDraftChange={(next) => {
              setFrequency(next);
              if (errors.frequency || errors.weeklyTarget || errors.weekdays) {
                clearError("frequency");
                clearError("weeklyTarget");
                clearError("weekdays");
              }
            }}
            errors={errors}
          />
        )}

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

        {/* R4: "Hora del aviso" and "Franja" (optional; reminder-input.ts). */}
        <ReminderFields
          ref={reminderFields}
          value={reminder}
          onChange={setReminder}
          errors={errors}
          offerTime={!avoid}
          onEdit={(field) => {
            if (errors[field]) clearError(field);
          }}
        />

        {/* H5 ("Más detalles"): identity, cue and, creating, the start date. */}
        <DetailsFields
          ref={detailsFields}
          value={details}
          onChange={setDetails}
          errors={errors}
          editing={editing}
          today={today}
          onEdit={(field) => {
            if (errors[field]) clearError(field);
          }}
        />

        <p className="bo-text-body-sm text-text-secondary">
          <span className="bo-text-label">{HABITS_COPY.summaryLabel}: </span>
          <span id={summaryId}>
            {ruleSummary({ name, lifeAreaId, ...sentFrequency, ...measureDraft(measure) })}
          </span>
        </p>

        {formError ? (
          <p role="alert" className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {formError}
          </p>
        ) : null}
        {/* The key's text changes too, but a screen reader on another control wouldn't hear it. */}
        <p role="status" className="sr-only">
          {pending ? (editing ? ORGANIZE_COPY.savingStatus : HABITS_COPY.creatingStatus) : ""}
        </p>
      </form>
    </Sheet>
  );
}
