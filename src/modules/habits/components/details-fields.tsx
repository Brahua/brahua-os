"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Icon, TextField } from "@/design-system";
import { cn } from "@/lib/cn";
import type { DetailsField } from "../details-input";
import { HABIT_CUE_MAX_LENGTH, HABIT_IDENTITY_MAX_LENGTH } from "../habit-constants";
import { HISTORY_COPY } from "../history-copy";
import { logWindowStart } from "../schedule";

/** "Más detalles" as typed. */
export type DetailsDraft = { identity: string; cue: string; startDate: string };

export type DetailsFieldsHandle = {
  /** Opens the section and focuses a field (the first invalid one after a submit). */
  focus: (field: DetailsField) => void;
};

type DetailsFieldsProps = {
  ref?: React.Ref<DetailsFieldsHandle>;
  value: DetailsDraft;
  onChange: (value: DetailsDraft) => void;
  errors: Partial<Record<DetailsField, string>>;
  /** Editing: the start date never changes, so it isn't offered. */
  editing: boolean;
  /** Lima's today: the start date goes from 7 days back to today. */
  today: string;
  /** A field was typed in (its error clears). */
  onEdit: (field: DetailsField) => void;
};

/**
 * H5: "Más detalles" of the create and edit form (SPEC-habits "Crear y editar"), folded: the
 * identity phrase ("Soy alguien que lee", ≤ 120), the cue ("Después del desayuno", ≤ 60) and,
 * only when creating, the start date (today or up to 7 days back). Open from the start when
 * there is something in it (editing a habit with an identity or a cue).
 */
export function DetailsFields({
  ref,
  value,
  onChange,
  errors,
  editing,
  today,
  onEdit,
}: DetailsFieldsProps) {
  const [open, setOpen] = useState(() => Boolean(value.identity || value.cue));
  const ids = useId();
  const panelId = `${ids}-panel`;
  const identityInput = useRef<HTMLInputElement>(null);
  const cueInput = useRef<HTMLInputElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const inputOf = (field: DetailsField) =>
    field === "identity"
      ? identityInput.current
      : field === "cue"
        ? cueInput.current
        : startInput.current;
  // Focus after the panel is shown (the commit that opens it).
  const pendingFocus = useRef<DetailsField | null>(null);

  useImperativeHandle(ref, () => ({
    focus(field) {
      if (open) {
        inputOf(field)?.focus();
        return;
      }
      pendingFocus.current = field;
      setOpen(true);
    },
  }));

  useEffect(() => {
    const field = pendingFocus.current;
    if (!open || !field) return;
    pendingFocus.current = null;
    inputOf(field)?.focus();
  });

  const invalid = Object.values(errors).some(Boolean);

  return (
    <div className="flex flex-col gap-4" data-habit-details="">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((previous) => !previous)}
        className={cn(
          "bo-section-label min-h-11 cursor-pointer rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          invalid && !open && "text-text",
        )}
      >
        <span className="flex flex-col items-start gap-0.5 text-left">
          <span className="bo-section-label__title">{HISTORY_COPY.moreDetails}</span>
          <span className="bo-text-body-sm text-text-secondary normal-case">
            {editing ? HISTORY_COPY.moreDetailsEditHelp : HISTORY_COPY.moreDetailsHelp}
          </span>
        </span>
        <Icon icon={ChevronDown} size="sm" className={cn(open && "rotate-180")} />
      </button>
      {/* Folded, its fields aren't there at all (Enter in "Nombre" still submits the form). */}
      <div id={panelId} hidden={!open} className="flex flex-col gap-6">
        {open ? (
          <>
            <TextField
              ref={identityInput}
              id={`${ids}-identity`}
              label={HISTORY_COPY.identityField}
              name="identity"
              value={value.identity}
              autoComplete="off"
              maxLength={HABIT_IDENTITY_MAX_LENGTH * 2}
              error={errors.identity}
              help={HISTORY_COPY.identityHelp}
              onChange={(event) => {
                onChange({ ...value, identity: event.target.value });
                onEdit("identity");
              }}
            />
            <TextField
              ref={cueInput}
              id={`${ids}-cue`}
              label={HISTORY_COPY.cueField}
              name="cue"
              value={value.cue}
              autoComplete="off"
              maxLength={HABIT_CUE_MAX_LENGTH * 2}
              error={errors.cue}
              help={HISTORY_COPY.cueHelp}
              onChange={(event) => {
                onChange({ ...value, cue: event.target.value });
                onEdit("cue");
              }}
            />
            {editing ? null : (
              <TextField
                ref={startInput}
                id={`${ids}-start`}
                type="date"
                className="bo-date-field"
                label={HISTORY_COPY.startDateField}
                name="startDate"
                value={value.startDate}
                min={logWindowStart(today)}
                max={today}
                error={errors.startDate}
                help={HISTORY_COPY.startDateHelp}
                onChange={(event) => {
                  onChange({ ...value, startDate: event.target.value });
                  onEdit("startDate");
                }}
              />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** "Más detalles" of a new habit (starts today) or of the habit edited. */
export function detailsDraftOf(
  habit: { identity: string | null; cue: string | null } | null,
  today: string,
): DetailsDraft {
  return { identity: habit?.identity ?? "", cue: habit?.cue ?? "", startDate: today };
}

/**
 * What the form sends: only what changed. Editing, identity and cue when they changed (blank
 * clears them); creating, what was filled in (a start date other than today).
 */
export function detailsValues(
  draft: DetailsDraft,
  habit: { identity: string | null; cue: string | null } | null,
  today: string,
) {
  if (habit) {
    return {
      identity: draft.identity !== (habit.identity ?? "") ? draft.identity : undefined,
      cue: draft.cue !== (habit.cue ?? "") ? draft.cue : undefined,
    };
  }
  return {
    identity: draft.identity || undefined,
    cue: draft.cue || undefined,
    startDate: draft.startDate === today ? undefined : draft.startDate,
  };
}
