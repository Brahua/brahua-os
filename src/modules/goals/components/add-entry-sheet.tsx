"use client";

import { useId, useState } from "react";
import { Key, Sheet, TextField } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { addEntryInputSchema, type GoalItem } from "../goal-input";
import { GOALS_COPY } from "../goals-copy";
import { unitOf } from "../goal-text";

/** The field's text as a number for the schema: blank is "missing", anything else as typed. */
function parseAmount(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

export type AddEntrySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The goal, as it is shown. */
  goal: GoalItem;
  /** Where focus goes when the sheet closes (the "Sumar…" key). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClosed?: () => void;
  /** The amount to add (the screen closes the sheet and saves it, optimistically). */
  onSave: (goal: GoalItem, delta: number) => void;
};

/**
 * "Sumar…" (SPEC-goals "Meta manual"): an amount other than 1, negative to correct what was added
 * by mistake. Validates with the action's own schema; the Server Action validates again.
 */
export function AddEntrySheet({
  open,
  onOpenChange,
  goal,
  returnFocusRef,
  onClosed,
  onSave,
}: AddEntrySheetProps) {
  const isDesktop = useIsDesktop();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const ids = useId();
  const formId = `${ids}-form`;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = addEntryInputSchema.shape.delta.safeParse(parseAmount(text));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    onSave(goal, parsed.data);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={GOALS_COPY.addSheetTitle(goal.title)}
      description={GOALS_COPY.addSheetDescription}
      returnFocusRef={returnFocusRef}
      onClosed={onClosed}
      footer={
        <>
          <Key variant="ghost" className="flex-1 lg:flex-none" onClick={() => onOpenChange(false)}>
            {GOALS_COPY.cancel}
          </Key>
          <Key type="submit" form={formId} variant="signal" className="flex-1">
            {GOALS_COPY.addSubmit}
          </Key>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-6">
        <TextField
          label={`${GOALS_COPY.addAmount} (${unitOf(goal)})`}
          name="amount"
          type="number"
          step={1}
          value={text}
          autoComplete="off"
          autoFocus
          error={error}
          help={GOALS_COPY.addAmountHelp}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError(undefined);
          }}
        />
      </form>
    </Sheet>
  );
}
