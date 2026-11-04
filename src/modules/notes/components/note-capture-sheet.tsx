"use client";

import { TriangleAlert } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";
import { Icon, Key, Sheet, TextField } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import type { CaptureSheetProps } from "@/lib/quick-capture";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { useAnnouncer } from "@/modules/core/components/screen-services";
import { captureNote, undoCaptureNote } from "../actions";
import { NOTES_COPY as COPY, NOTES_ERRORS } from "../copy";
import { captureNoteInputSchema, type CapturedLine } from "../note-input";
import { failureReason } from "./use-note-autosave";

/**
 * The quick capture's «Nota» (SPEC-notes "Captura «Nota»"): one field, and «Añadir a la nota de
 * hoy» appends `- HH:MM texto` to today's note (created if the day has none). Like the other
 * captures it waits for the server and stays open, empty and focused for the next one, with «Se
 * añadió a la nota de hoy.» and its «Deshacer» inside the sheet (a notice of the shell would pile
 * up with the screen's own). «Deshacer» removes exactly that line, only if the note is still at the
 * version the capture left («Cambió mientras tanto» otherwise).
 */
export function NoteCaptureSheet({
  open,
  onOpenChange,
  returnFocusRef,
  switcher,
}: CaptureSheetProps) {
  const isDesktop = useIsDesktop();
  const ids = useId();
  const formId = `${ids}-form`;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<CapturedLine | null>(null);
  const [announcement, announce] = useAnnouncer();
  const [pending, startTransition] = useTransition();
  const [undoing, startUndo] = useTransition();
  const busy = pending || undoing;
  const input = useRef<HTMLInputElement>(null);
  // The latest text, to know after an await whether the owner kept typing.
  const textNow = useRef(text);

  // While saving, the sheet stays open (closing would lose the answer).
  function requestOpenChange(next: boolean) {
    if (!next && busy) return;
    onOpenChange(next);
  }

  function showError(message: string) {
    setError(message);
    // Focus stays in the field (Enter): the error is read through the sheet's status region.
    announce(message);
    input.current?.focus();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const parsed = captureNoteInputSchema.safeParse({ text });
    if (!parsed.success) {
      showError(parsed.error.issues[0]?.message ?? NOTES_ERRORS.captureEmpty);
      return;
    }
    setFormError(null);
    const sent = text;
    startTransition(async () => {
      let result: ActionResult<CapturedLine>;
      try {
        result = await captureNote(parsed.data);
      } catch {
        // Network failure or a new deployment: the action itself never throws.
        result = fail(COPY.checkConnection);
      }
      if (!result.ok) {
        showError(failureReason(result));
        return;
      }
      // Ready for the next one: empty, unless the owner already typed another.
      if (textNow.current === sent) {
        textNow.current = "";
        setText("");
      }
      setError(null);
      setSaved(result.data);
      input.current?.focus();
      announce(COPY.captured);
    });
  }

  function undoSaved() {
    const line = saved;
    if (!line || busy) return;
    startUndo(async () => {
      let result: ActionResult<{ noteId: string; version: number }>;
      try {
        result = await undoCaptureNote({
          noteId: line.noteId,
          version: line.version,
          appended: line.appended,
        });
      } catch {
        result = fail(COPY.checkConnection);
      }
      if (!result.ok) {
        setFormError(`${COPY.notUndone} ${failureReason(result)}`);
        return;
      }
      setSaved(null);
      setFormError(null);
      // The key leaves with the notice: focus goes back to the field.
      input.current?.focus();
      announce(COPY.captureUndone);
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={requestOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={COPY.captureTitle}
      returnFocusRef={returnFocusRef}
      initialFocusRef={input}
      closeDisabled={busy}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={busy || undefined}
            onClick={() => requestOpenChange(false)}
          >
            {COPY.captureClose}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={busy || undefined}
            shortcut={isDesktop ? "↵" : undefined}
          >
            {pending ? COPY.captureAdding : COPY.captureAdd}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-5"
        data-note-capture=""
        data-saving={busy ? "" : undefined}
      >
        {/* The shell's «Tarea · Gasto · Nota» switch. */}
        {switcher}

        <TextField
          ref={input}
          id={`${ids}-text`}
          label={COPY.captureTextLabel}
          name="text"
          value={text}
          autoComplete="off"
          enterKeyHint="done"
          required
          error={error ?? undefined}
          help={COPY.captureTextHelp}
          onKeyDown={(event) => {
            // Enter saves from the field even though the submit key lives in the sheet's footer
            // (outside the form): not left to implicit submission.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          onChange={(event) => {
            textNow.current = event.target.value;
            setText(event.target.value);
            if (error) setError(null);
          }}
        />

        {saved ? (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
            data-note-captured=""
          >
            <p className="bo-text-body-sm">{COPY.captured}</p>
            {/* 48 px (a touch key), like every key on the phone. */}
            <Key variant="ghost" aria-disabled={busy || undefined} onClick={undoSaved}>
              {COPY.undo}
            </Key>
          </div>
        ) : null}

        {formError ? (
          <p role="alert" className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {formError}
          </p>
        ) : null}
        {/* Polite: «Añadiendo…» while saving, then what happened. */}
        <p role="status" className="sr-only" data-capture-status="">
          {pending ? COPY.captureAddingStatus : announcement}
        </p>
      </form>
    </Sheet>
  );
}
