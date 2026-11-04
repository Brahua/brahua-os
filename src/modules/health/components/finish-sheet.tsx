"use client";

import { Check, RotateCw, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Key, Sheet, TextArea, TextField } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { HEALTH_COPY } from "../health-copy";
import { isLongSession, isValidEnd, proposedEnd } from "../session-end";
import { formatMinutes, fromLimaInput, minutesBetween, toLimaInput } from "../session-time";
import { SESSION_ERRORS, SESSIONS_COPY as COPY } from "../sessions-copy";
import { sessionNoteSchema } from "../sessions-input";

type FinishSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  startedAt: string;
  /** ISO instants of the done sets. */
  doneAts: readonly string[];
  /** Sets still unmarked: they go when it finishes. */
  planned: number;
  note: string;
  /** When the sheet opened (ms): the proposal and the bounds are fixed then. */
  openedAt: number;
  busy: boolean;
  /**
   * Sets the server doesn't have as they are on screen (a network failure): while there are any,
   * «Terminar» and «Descartar» wait (they would remove a set marked here as planned) and the sheet
   * offers «Reintentar».
   */
  unsaved: number;
  onRetryAll: () => void;
  /** «Terminar»: the end (ms, or null for now) and the note as typed. */
  onFinish: (end: number | null, note: string) => void;
  /** «Descartar la sesión» (no done set). */
  onDiscard: () => void;
};

/**
 * «Terminar» (SPEC-health "Terminar"): the duration, the done sets and the note; the unmarked sets
 * go. After more than 4 h it proposes the end (the last marked set + 5 min), editable between the
 * start and now. Without a done set it offers «Descartar la sesión» instead. Mount it with a new
 * `key` on each opening.
 */
export function FinishSheet({
  open,
  onOpenChange,
  returnFocusRef,
  startedAt,
  doneAts,
  planned,
  note: initialNote,
  openedAt,
  busy,
  unsaved,
  onRetryAll,
  onFinish,
  onDiscard,
}: FinishSheetProps) {
  const blocked = busy || unsaved > 0;
  const isDesktop = useIsDesktop();
  const ids = useId();
  const long = isLongSession(startedAt, openedAt);
  const [end, setEnd] = useState(() => toLimaInput(proposedEnd(startedAt, doneAts, openedAt)));
  const [note, setNote] = useState(initialNote);
  const [errors, setErrors] = useState<{ end?: string; note?: string }>({});
  const empty = doneAts.length === 0;
  const endMs = long ? fromLimaInput(end) : openedAt;
  const minutes = minutesBetween(startedAt, Number.isFinite(endMs) ? endMs : openedAt);

  function submit() {
    const parsedNote = sessionNoteSchema.safeParse(note);
    const nextErrors: typeof errors = {};
    if (!parsedNote.success) nextErrors.note = parsedNote.error.issues[0]?.message;
    if (long && !isValidEnd(startedAt, endMs, Date.now())) {
      nextErrors.end = SESSION_ERRORS.endOutOfRange;
    }
    setErrors(nextErrors);
    if (nextErrors.end) {
      document.getElementById(`${ids}-end`)?.focus();
      return;
    }
    if (nextErrors.note) {
      document.getElementById(`${ids}-note`)?.focus();
      return;
    }
    onFinish(long ? endMs : null, note);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      variant={isDesktop ? "side" : "bottom"}
      title={COPY.finishTitle}
      returnFocusRef={returnFocusRef}
      focusTitleOnOpen
      closeDisabled={busy}
    >
      <div className="flex flex-col gap-4" data-finish-sheet="">
        {unsaved > 0 ? (
          <div className="flex flex-col gap-2" data-finish-unsaved="">
            <p id={`${ids}-unsaved`} className="bo-text-body text-signal-text">
              {SESSION_ERRORS.unsavedSets}
            </p>
            <Key
              variant="default"
              icon={RotateCw}
              className="self-start"
              aria-label={COPY.retryAllName}
              data-finish-retry=""
              onClick={onRetryAll}
            >
              {COPY.retryAll}
            </Key>
          </div>
        ) : null}
        <p className="bo-text-heading tabular-nums" data-finish-summary="">
          {COPY.finishSummary(formatMinutes(minutes), doneAts.length)}
        </p>
        {empty ? (
          <>
            <p className="bo-text-body text-text-secondary">{COPY.discardHint}</p>
            <Key
              variant="signal"
              icon={Trash2}
              className="self-start"
              aria-disabled={blocked || undefined}
              aria-describedby={unsaved > 0 ? `${ids}-unsaved` : undefined}
              data-discard-session=""
              onClick={() => {
                if (!blocked) onDiscard();
              }}
            >
              {COPY.discard}
            </Key>
          </>
        ) : (
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!blocked) submit();
            }}
          >
            {planned > 0 ? (
              <p className="bo-text-body-sm text-text-secondary">
                {COPY.finishPlannedHint(planned)}
              </p>
            ) : null}
            {long ? (
              <>
                <p className="bo-text-body">{COPY.finishLong}</p>
                <TextField
                  id={`${ids}-end`}
                  type="datetime-local"
                  label={COPY.endLabel}
                  help={COPY.endHelp}
                  value={end}
                  min={toLimaInput(startedAt)}
                  max={toLimaInput(openedAt)}
                  error={errors.end}
                  data-finish-end=""
                  onChange={(event) => {
                    setEnd(event.target.value);
                    setErrors((current) => ({ ...current, end: undefined }));
                  }}
                />
              </>
            ) : null}
            <TextArea
              id={`${ids}-note`}
              label={COPY.note}
              help={COPY.noteHelp}
              value={note}
              error={errors.note}
              rows={3}
              data-finish-note=""
              onChange={(event) => {
                setNote(event.target.value);
                setErrors((current) => ({ ...current, note: undefined }));
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Key
                type="submit"
                variant="signal"
                icon={Check}
                aria-disabled={blocked || undefined}
                aria-describedby={unsaved > 0 ? `${ids}-unsaved` : undefined}
                data-finish-confirm=""
              >
                {COPY.finishConfirm}
              </Key>
              <Key
                variant="ghost"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) onOpenChange(false);
                }}
              >
                {HEALTH_COPY.cancel}
              </Key>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}
