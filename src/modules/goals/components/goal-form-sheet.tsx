"use client";

import { ChevronDown, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  AREA_ICONS,
  Icon,
  Key,
  Led,
  SegmentedControl,
  Sheet,
  TextArea,
  TextField,
} from "@/design-system";
import { fail, type ActionResult, type FieldErrors } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { FieldError } from "@/modules/core/components/field-error";
import {
  focusRadioGrid,
  RadioGrid,
  type RadioGridOption,
} from "@/modules/core/components/radio-grid";
import { createGoal, updateGoal } from "../actions";
import type { GoalPeriodKind } from "../goal-constants";
import {
  CREATE_GOAL_FIELDS,
  createGoalInputSchema,
  updateGoalInputSchema,
  type CreateGoalField,
  type GoalAreaSummary,
  type GoalItem,
} from "../goal-input";
import { GOALS_COPY } from "../goals-copy";
import { currentPeriod, periodLabel, periodOf } from "../pace";

/** The area picker's value for "Sin área". */
const NO_AREA = "";

type Errors = Partial<Record<CreateGoalField, string>>;

function firstErrors(fieldErrors: FieldErrors | undefined): Errors {
  const errors: Errors = {};
  for (const field of CREATE_GOAL_FIELDS) {
    const message = fieldErrors?.[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

/** The target's text as a number for the schema: blank is "missing", anything else as typed. */
function parseTarget(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

export type GoalFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active life areas, in their order: the only ones a goal can be put in. */
  areas: readonly GoalAreaSummary[];
  /** Where focus goes if the sheet closes without creating (the key that opened it). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** The goal to edit (the form starts from it and saves with `updateGoal`). */
  goal?: GoalItem | null;
  /** Lima's today (the screen's): the current year and quarter. */
  today: string;
  /** Created (or, editing, saved): the screen closes the sheet and focuses its row. */
  onCreated: (goal: GoalItem) => void;
  /** Called once the sheet has fully closed (see `Sheet`). */
  onClosed?: () => void;
};

/**
 * "Nueva meta" and, with `goal`, "Editar meta" (SPEC-goals "Crear/editar"): the title (focused),
 * the period (the current year or quarter), "¿Cómo la mido?", the target and the unit; the area
 * and the notes are folded. Aims at under 20 seconds on the phone. Validates on the client with
 * the action's own schema; the Server Action validates again (the authority). Not optimistic: it
 * waits for the server ("Creando…", "Guardando…"), and the sheet stays open meanwhile.
 *
 * G2 slot: "¿Cómo la mido?" offers only "Cantidad" for now. Adding "Hábito" and "Proyecto" means
 * adding their options below and their fields (a habit picker and "Días a cumplir", a project
 * picker); `createGoalInputSchema` already validates all three sources.
 */
export function GoalFormSheet({
  open,
  onOpenChange,
  areas: activeAreas,
  returnFocusRef,
  goal = null,
  today,
  onCreated,
  onClosed,
}: GoalFormSheetProps) {
  const isDesktop = useIsDesktop();
  const editing = goal !== null;
  // Editing a goal whose area was archived since: that area stays offered (and picked), so saving
  // never drops it by accident.
  const keptArea =
    goal?.area && !activeAreas.some((area) => area.id === goal.area?.id) ? goal.area : null;
  const areas = keptArea ? [...activeAreas, keptArea] : activeAreas;
  const [title, setTitle] = useState(goal?.title ?? "");
  const [periodKind, setPeriodKind] = useState<GoalPeriodKind>("year");
  const [target, setTarget] = useState(goal ? String(goal.target) : "");
  const [unit, setUnit] = useState(goal?.unit ?? "");
  const [pickedAreaId, setAreaId] = useState<string>(goal?.area?.id ?? NO_AREA);
  const [notes, setNotes] = useState(goal?.notes ?? "");
  // Only an area that is still offered counts as picked.
  const areaId = areas.some((area) => area.id === pickedAreaId) ? pickedAreaId : NO_AREA;
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Set by a failed submit; the next commit moves focus to the first invalid field.
  const focusFirstInvalid = useRef(false);
  const [detailsOpen, setDetailsOpen] = useState(Boolean(goal?.notes || goal?.area));

  const ids = useId();
  const formId = `${ids}-form`;
  const titleInput = useRef<HTMLInputElement>(null);
  const targetInput = useRef<HTMLInputElement>(null);
  const unitInput = useRef<HTMLInputElement>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const areaGroup = useRef<HTMLDivElement>(null);
  const periodGroup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusFirstInvalid.current) return;
    const first = CREATE_GOAL_FIELDS.find((field) => errors[field]);
    focusFirstInvalid.current = false;
    if (first === "title") titleInput.current?.focus();
    else if (first === "target") targetInput.current?.focus();
    else if (first === "unit") unitInput.current?.focus();
    else if (first === "notes") notesInput.current?.focus();
    else if (first === "areaId") focusRadioGrid(areaGroup.current);
    else if (first === "periodKind") periodGroup.current?.querySelector("button")?.focus();
  });

  // While saving, the sheet stays open: Esc, the scrim, ✕ and Cancelar do nothing.
  function requestOpenChange(next: boolean) {
    if (!next && pending) return;
    onOpenChange(next);
  }

  function showErrors(result: { error: string; fieldErrors?: FieldErrors }) {
    const fieldErrors = firstErrors(result.fieldErrors);
    focusFirstInvalid.current = true;
    // The area and the notes are folded: open them so the error (and the focus) can land there.
    if (fieldErrors.areaId || fieldErrors.notes) setDetailsOpen(true);
    setErrors(fieldErrors);
    const other = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
    setFormError(Object.keys(fieldErrors).length > 0 ? null : (other ?? result.error));
  }

  function clearError(field: CreateGoalField) {
    setErrors((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const common = {
      title,
      notes,
      areaId,
      sourceKind: "manual" as const,
      target: parseTarget(target),
      unit,
    };
    const period = currentPeriod(periodKind, today);
    const parsed = goal
      ? updateGoalInputSchema.safeParse({ id: goal.id, ...common })
      : createGoalInputSchema.safeParse({
          ...common,
          periodKind,
          year: period.year,
          quarter: period.kind === "quarter" ? period.quarter : null,
        });
    if (!parsed.success) {
      const failed = fail(parsed.error);
      if (!failed.ok) showErrors(failed);
      return;
    }
    setFormError(null);
    startTransition(async () => {
      let result: ActionResult<GoalItem>;
      try {
        result = await (goal ? updateGoal(parsed.data) : createGoal(parsed.data));
      } catch {
        // Network failure or a new deployment: the action itself never throws.
        result = fail(GOALS_COPY.unexpected);
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
      label: GOALS_COPY.noArea,
      children: <span className="bo-option-key__label">{GOALS_COPY.noArea}</span>,
    },
    ...areas.map((area) => {
      const label = area.id === keptArea?.id ? GOALS_COPY.archivedArea(area.name) : area.name;
      return {
        value: area.id,
        label,
        children: (
          <>
            <Led area={area.color} size="sm" />
            <Icon icon={AREA_ICONS[area.icon]} size="sm" />
            <span className="bo-option-key__label" title={label}>
              {label}
            </span>
          </>
        ),
      };
    }),
  ];

  const periodLabelId = `${ids}-period-label`;
  const sourceLabelId = `${ids}-source-label`;
  const areaLabelId = `${ids}-area-label`;
  const areaHintId = `${ids}-area-hint`;
  const areaErrorId = `${ids}-area-error`;
  const detailsId = `${ids}-details`;
  const picked = currentPeriod(periodKind, today);

  return (
    <Sheet
      open={open}
      onOpenChange={requestOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={editing ? GOALS_COPY.editGoalTitle : GOALS_COPY.newGoalTitle}
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
            {GOALS_COPY.cancel}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={pending || undefined}
          >
            {editing
              ? pending
                ? GOALS_COPY.saving
                : GOALS_COPY.save
              : pending
                ? GOALS_COPY.creating
                : GOALS_COPY.create}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-6"
        // E2E `afterSaveSettled` waits for this while the save is in flight.
        data-saving={pending ? "" : undefined}
      >
        <TextField
          ref={titleInput}
          label={GOALS_COPY.titleLabel}
          name="title"
          value={title}
          autoComplete="off"
          autoFocus
          required
          error={errors.title}
          help={GOALS_COPY.titleHelp}
          id={`${ids}-title`}
          onChange={(event) => {
            setTitle(event.target.value);
            if (errors.title) clearError("title");
          }}
        />

        {/* The period: the current year or quarter. It never changes in an edit. */}
        <div className={cn("bo-field", errors.periodKind && "is-error")}>
          <span id={periodLabelId} className="bo-field__label">
            {GOALS_COPY.periodLabel}
          </span>
          {goal ? (
            <p className="bo-text-body">{GOALS_COPY.periodFixed(periodLabel(periodOf(goal)))}</p>
          ) : (
            <div ref={periodGroup} className="flex flex-col gap-2">
              <SegmentedControl<GoalPeriodKind>
                mode="radio"
                touch
                label={GOALS_COPY.periodLabel}
                options={[
                  { value: "year", label: GOALS_COPY.periodYear },
                  { value: "quarter", label: GOALS_COPY.periodQuarter },
                ]}
                value={periodKind}
                onValueChange={(value) => {
                  setPeriodKind(value);
                  if (errors.periodKind) clearError("periodKind");
                }}
              />
              <span className="bo-field__help" data-goal-period="">
                {periodKind === "year"
                  ? GOALS_COPY.periodYearValue(periodLabel(picked))
                  : GOALS_COPY.periodQuarterValue(periodLabel(picked))}
              </span>
            </div>
          )}
          {errors.periodKind ? (
            <FieldError id={`${ids}-period-error`} message={errors.periodKind} />
          ) : null}
        </div>

        {/* G2 slot: "Hábito" and "Proyecto" join "Cantidad" here (see the header). */}
        <div className={cn("bo-field", errors.sourceKind && "is-error")}>
          <span id={sourceLabelId} className="bo-field__label">
            {GOALS_COPY.sourceLabel}
          </span>
          <SegmentedControl<"manual">
            mode="radio"
            touch
            label={GOALS_COPY.sourceLabel}
            options={[{ value: "manual", label: GOALS_COPY.sourceManual }]}
            value="manual"
          />
          <span className="bo-field__help">{GOALS_COPY.sourceHelp}</span>
          {errors.sourceKind ? (
            <FieldError id={`${ids}-source-error`} message={errors.sourceKind} />
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <TextField
            ref={targetInput}
            label={GOALS_COPY.targetLabel}
            name="target"
            value={target}
            inputMode="numeric"
            autoComplete="off"
            required
            error={errors.target}
            help={GOALS_COPY.targetHelp}
            id={`${ids}-target`}
            onChange={(event) => {
              setTarget(event.target.value);
              if (errors.target) clearError("target");
            }}
          />
          <TextField
            ref={unitInput}
            label={GOALS_COPY.unitLabel}
            name="unit"
            value={unit}
            autoComplete="off"
            required
            error={errors.unit}
            help={GOALS_COPY.unitHelp}
            id={`${ids}-unit`}
            onChange={(event) => {
              setUnit(event.target.value);
              if (errors.unit) clearError("unit");
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((previous) => !previous)}
            className="bo-section-label min-h-11 cursor-pointer rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span className="bo-section-label__title">{GOALS_COPY.moreDetails}</span>
            <Icon icon={ChevronDown} size="sm" className={cn(detailsOpen && "rotate-180")} />
          </button>
          <p className="bo-text-body-sm px-1 text-text-secondary">{GOALS_COPY.moreDetailsHelp}</p>
          <div id={detailsId} hidden={!detailsOpen} className="mt-2 flex flex-col gap-6">
            {detailsOpen ? (
              <>
                <div className={cn("bo-field", errors.areaId && "is-error")}>
                  <span id={areaLabelId} className="bo-field__label">
                    {GOALS_COPY.areaLabel}
                  </span>
                  <RadioGrid
                    ref={areaGroup}
                    options={areaOptions}
                    value={areaId}
                    onValueChange={(value) => {
                      setAreaId(value);
                      if (errors.areaId) clearError("areaId");
                    }}
                    labelledBy={areaLabelId}
                    describedBy={errors.areaId ? `${areaHintId} ${areaErrorId}` : undefined}
                    errorId={errors.areaId ? areaErrorId : undefined}
                    invalid={Boolean(errors.areaId)}
                    className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2"
                    itemClassName="bo-option-key min-w-0"
                  />
                  {errors.areaId ? <FieldError id={areaErrorId} message={errors.areaId} /> : null}
                </div>
                <TextArea
                  ref={notesInput}
                  label={GOALS_COPY.notesLabel}
                  name="notes"
                  value={notes}
                  rows={3}
                  error={errors.notes}
                  id={`${ids}-notes`}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    if (errors.notes) clearError("notes");
                  }}
                />
              </>
            ) : null}
          </div>
        </div>

        {formError ? (
          <p role="alert" className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {formError}
          </p>
        ) : null}
        {/* The key's text changes too, but a screen reader on another control wouldn't hear it. */}
        <p role="status" className="sr-only">
          {pending ? (editing ? GOALS_COPY.savingStatus : GOALS_COPY.creatingStatus) : ""}
        </p>
      </form>
    </Sheet>
  );
}
