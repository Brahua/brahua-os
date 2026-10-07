"use client";

import { useId, useRef, useState } from "react";
import { Key, Sheet } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { POSTPONE_COPY } from "../postpone-copy";
import { POSTPONE_ERRORS } from "../task-postpone";
import { TASK_ERRORS } from "../task-input";
import { DateField } from "./date-field";

type PostponeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: { id: string; title: string };
  /** The earliest day it offers (YYYY-MM-DD): today, or tomorrow where today would not move it. */
  minDay: string;
  /** Where the date starts (YYYY-MM-DD). */
  initialDay: string;
  /** Where focus goes on close (the "Otro día…" key, or a neighbor if the row is leaving). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** Called once the sheet has fully closed. */
  onClosed?: () => void;
  /** "Mover": the list applies it at once and saves it in the background. */
  onSave: (task: { id: string; title: string }, day: string) => void;
};

/** A real calendar day, YYYY-MM-DD. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Otro día…": a date picker in the same sheet the lists use (bottom on the phone, side panel on
 * the desktop). "Mover" closes it at once; the list moves the row and offers "Deshacer".
 */
export function PostponeSheet({
  open,
  onOpenChange,
  task,
  minDay,
  initialDay,
  returnFocusRef,
  onClosed,
  onSave,
}: PostponeSheetProps) {
  const isDesktop = useIsDesktop();
  const ids = useId();
  const formId = `${ids}-form`;
  const [day, setDay] = useState(initialDay);
  const [error, setError] = useState<string | undefined>();
  const dayInput = useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const valid = DAY.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));
    const message = !valid ? TASK_ERRORS.dateInvalid : day < minDay ? POSTPONE_ERRORS.pastDay : null;
    if (message) {
      setError(message);
      dayInput.current?.focus();
      return;
    }
    onSave(task, day);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={POSTPONE_COPY.sheetTitle}
      description={POSTPONE_COPY.sheetDescription(task.title)}
      returnFocusRef={returnFocusRef}
      // On the phone the picker would open the system wheel at once: focus the title instead.
      initialFocusRef={isDesktop ? dayInput : undefined}
      focusTitleOnOpen={!isDesktop}
      onClosed={onClosed}
      footer={
        <>
          <Key variant="ghost" className="flex-1 lg:flex-none" onClick={() => onOpenChange(false)}>
            {POSTPONE_COPY.cancel}
          </Key>
          <Key type="submit" form={formId} variant="signal" className="flex-1">
            {POSTPONE_COPY.move}
          </Key>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-5">
        <DateField
          ref={dayInput}
          id={`${ids}-day`}
          label={POSTPONE_COPY.dayLabel}
          value={day}
          min={minDay}
          help={POSTPONE_COPY.dayHelp}
          error={error}
          onChange={(event) => {
            setDay(event.target.value);
            setError(undefined);
          }}
        />
      </form>
    </Sheet>
  );
}
