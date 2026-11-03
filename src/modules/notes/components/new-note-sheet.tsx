"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Key, Sheet, TextField } from "@/design-system";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { createNote } from "../actions";
import { NOTES_COPY as COPY } from "../copy";
import { NOTE_TITLE_MAX_LENGTH } from "../note-constants";
import { createNoteInputSchema, type NoteArea } from "../note-input";
import { notePath } from "../routes";
import { AreaSelect, NO_AREA } from "./area-select";

type NewNoteSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The active areas, in their order. */
  areas: readonly NoteArea[];
  /** Focus goes back here when the sheet closes without creating. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
};

type Errors = { title?: string; areaId?: string; form?: string };

/**
 * «Nueva nota» (SPEC-notes "Pantallas"): a title and, optionally, a life area. Creating opens the
 * new note, empty, in the editor (the text is written there, never in the sheet).
 */
export function NewNoteSheet({ open, onOpenChange, areas, returnFocusRef }: NewNoteSheetProps) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const ids = useId();
  const formId = `${ids}-form`;
  const [title, setTitle] = useState("");
  const [areaId, setAreaId] = useState(NO_AREA);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const titleField = useRef<HTMLInputElement>(null);

  function requestOpenChange(next: boolean) {
    if (pending && !next) return;
    onOpenChange(next);
  }

  async function submit() {
    if (pending) return;
    const input = { title, areaId: areaId === NO_AREA ? null : areaId };
    const parsed = createNoteInputSchema.safeParse(input);
    if (!parsed.success) {
      const title = parsed.error.issues.find((issue) => issue.path[0] === "title")?.message;
      setErrors({ title });
      titleField.current?.focus();
      return;
    }
    setPending(true);
    let result;
    try {
      result = await createNote(parsed.data);
    } catch {
      result = null;
    }
    if (!result || !result.ok) {
      setPending(false);
      const fieldErrors = result?.ok === false ? result.fieldErrors : undefined;
      setErrors({
        title: fieldErrors?.title?.[0],
        areaId: fieldErrors?.areaId?.[0],
        form: fieldErrors ? undefined : result?.ok === false ? result.error : COPY.checkConnection,
      });
      if (fieldErrors?.title) titleField.current?.focus();
      return;
    }
    router.push(notePath(result.data.id));
  }

  return (
    <Sheet
      open={open}
      onOpenChange={requestOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={COPY.newNoteTitle}
      description={COPY.newNoteText}
      returnFocusRef={returnFocusRef}
      initialFocusRef={titleField}
      closeDisabled={pending}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={pending || undefined}
            onClick={() => requestOpenChange(false)}
          >
            {COPY.cancel}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={pending || undefined}
            data-new-note-create=""
          >
            {pending ? COPY.creating : COPY.create}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField
          ref={titleField}
          label={COPY.titleLabel}
          value={title}
          maxLength={NOTE_TITLE_MAX_LENGTH * 2}
          autoComplete="off"
          error={errors.title}
          onChange={(event) => {
            setTitle(event.target.value);
            if (errors.title) setErrors((current) => ({ ...current, title: undefined }));
          }}
        />
        <AreaSelect
          id={`${ids}-area`}
          label={COPY.areaLabel}
          areas={areas}
          value={areaId}
          help={COPY.areaHelp}
          error={errors.areaId}
          onValueChange={(value) => {
            setAreaId(value);
            if (errors.areaId) setErrors((current) => ({ ...current, areaId: undefined }));
          }}
        />
        {errors.form ? (
          <p role="alert" className="bo-text-body-sm">
            {errors.form}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
