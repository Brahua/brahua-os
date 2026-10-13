"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { Key, TextArea, TextField } from "@/design-system";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { closeWeek } from "../actions";
import { PROXIMA_COPY as COPY, REVIEW_COPY } from "../review-copy";
import { closeWeekActionSchema } from "../review-input";
import { reviewClosedPath } from "../routes";

type StepProximaProps = {
  /** The Monday of the week being closed. */
  weekStart: string;
  /** «19 al 25 de octubre»: the NEXT week, for the objective's label. */
  nextRange: string;
  /** The objective already set for the next week (the one /goals shows), or null. */
  objective: string | null;
  /** The note of the week if it was closed before, or null. */
  note: string | null;
  /** The week already has its review: the form edits it. */
  closed: boolean;
};

type Errors = { objective?: string; note?: string; form?: string };

/** The first message of a field in an action's failure, if the server named one. */
function fieldError(result: { fieldErrors?: Record<string, string[]> }, field: string) {
  return result.fieldErrors?.[field]?.[0];
}

/**
 * Step 4 · Próxima semana (SPEC-weekly-review "Pantallas"): the objective of the next week (the
 * same store as /goals, prefilled with what it already has), an optional note of this week and
 * «Cerrar la semana». The close is one Server Action and idempotent: a week that is already
 * closed shows «Esta semana ya está cerrada» and the same form saves the note again.
 *
 * - Saving never disables the focused key: `aria-disabled` plus a guard (a second press does
 *   nothing). A failure keeps everything typed and says why next to the field (or above the key).
 * - Success goes to the closing screen; the announcer says it first. No timers here.
 */
export function StepProxima({ weekStart, nextRange, objective, note, closed }: StepProximaProps) {
  const router = useRouter();
  const { announce } = useRequiredScreenServices();
  const [objectiveText, setObjectiveText] = useState(objective ?? "");
  const [noteText, setNoteText] = useState(note ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const inflight = useRef(false);
  const objectiveField = useRef<HTMLInputElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const formError = useRef<HTMLParagraphElement>(null);

  /** Set with the messages: once they render, focus goes to what the first one is about. */
  const pendingFocus = useRef<Errors | null>(null);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    if (pending.objective) objectiveField.current?.focus();
    else if (pending.note) noteField.current?.focus();
    else formError.current?.focus();
  }, [errors]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inflight.current) return;
    const input = { weekStart, note: noteText, objective: objectiveText };
    const parsed = closeWeekActionSchema.safeParse(input);
    if (!parsed.success) {
      const next: Errors = {
        objective: parsed.error.issues.find((issue) => issue.path[0] === "objective")?.message,
        note: parsed.error.issues.find((issue) => issue.path[0] === "note")?.message,
      };
      pendingFocus.current = next;
      setErrors(next);
      return;
    }
    inflight.current = true;
    setSaving(true);
    setErrors({});
    let failure: Errors;
    try {
      const result = await closeWeek(input);
      if (result.ok) {
        announce(closed ? COPY.announceUpdated : COPY.announceClosed);
        router.push(reviewClosedPath(weekStart));
        // Stay "saving" until the closing screen replaces this one (no second press in between).
        return;
      }
      failure = {
        objective: fieldError(result, "objective"),
        note: fieldError(result, "note"),
        form: result.error,
      };
    } catch {
      failure = { form: REVIEW_COPY.checkConnection };
    }
    inflight.current = false;
    setSaving(false);
    // What was typed stays; the failure says why.
    pendingFocus.current = failure;
    setErrors(failure);
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex max-w-160 flex-col gap-5"
      data-review-step="proxima"
      data-closed={closed ? "" : undefined}
    >
      {closed ? (
        <div className="flex flex-col gap-1" data-review-closed="">
          <p className="bo-text-title">{COPY.closed}</p>
          <p className="bo-text-body-sm text-text-secondary">{COPY.closedHelp}</p>
        </div>
      ) : null}

      <TextField
        ref={objectiveField}
        label={COPY.objectiveLabel(nextRange)}
        name="objective"
        value={objectiveText}
        autoComplete="off"
        enterKeyHint="next"
        error={errors.objective}
        help={objective ? COPY.objectiveExisting : COPY.objectiveHelp}
        onChange={(event) => {
          setObjectiveText(event.target.value);
          if (errors.objective) setErrors((current) => ({ ...current, objective: undefined }));
        }}
      />

      <TextArea
        ref={noteField}
        label={COPY.noteLabel}
        name="note"
        rows={3}
        value={noteText}
        error={errors.note}
        help={COPY.noteHelp}
        onChange={(event) => {
          setNoteText(event.target.value);
          if (errors.note) setErrors((current) => ({ ...current, note: undefined }));
        }}
      />

      {errors.form && !errors.objective && !errors.note ? (
        <p
          ref={formError}
          tabIndex={-1}
          role="alert"
          className="bo-text-body-sm outline-none"
          data-review-error=""
        >
          {errors.form}
        </p>
      ) : null}

      <div>
        <Key
          type="submit"
          variant="signal"
          aria-disabled={saving || undefined}
          data-review-close=""
        >
          {closed ? COPY.closeAgain : COPY.close}
        </Key>
      </div>
    </form>
  );
}
