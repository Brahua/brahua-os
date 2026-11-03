"use client";

import { Pencil, Pin, PinOff } from "lucide-react";
import { startTransition, useEffect, useId, useOptimistic, useRef, useState } from "react";
import { Key, TextField } from "@/design-system";
import { normalizeName } from "@/lib/text";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { pinNote, renameNote, setNoteArea } from "../actions";
import { NOTES_COPY as COPY } from "../copy";
import { NOTE_TITLE_MAX_LENGTH } from "../note-constants";
import { noteTitleSchema, type NoteArea, type NoteItem } from "../note-input";
import { AreaSelect, NO_AREA } from "./area-select";
import { failureReason } from "./use-note-autosave";

type PageNoteHeaderProps = {
  note: NoteItem;
  /** The active areas, in their order. */
  areas: readonly NoteArea[];
  /** Id of the `<h1>`. */
  headingId: string;
};

/**
 * A knowledge note's header (SPEC-notes "Pantallas"): the title, changed in place («Cambiar
 * título»: Enter saves, Esc cancels, focus back on the key), its life area and «Fijar». Area and pin
 * show at once and go back with a «Sin guardar» notice if the server refuses.
 */
export function PageNoteHeader({ note, areas, headingId }: PageNoteHeaderProps) {
  const { toaster, announce } = useRequiredScreenServices();
  const ids = useId();
  const [pinned, setOptimisticPinned] = useOptimistic(note.pinned);
  const [areaId, setOptimisticArea] = useOptimistic(note.area?.id ?? NO_AREA);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(note.title ?? "");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const renameKey = useRef<HTMLButtonElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const title = note.title ?? "";

  // Element to focus after the next render (the rename form opened or closed).
  const pendingFocus = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const find = pendingFocus.current;
    if (!find) return;
    pendingFocus.current = null;
    find()?.focus();
  });

  function openRename() {
    setDraft(title);
    setError(undefined);
    setRenaming(true);
    pendingFocus.current = () => titleField.current;
  }

  function closeRename() {
    setRenaming(false);
    setError(undefined);
    pendingFocus.current = () => renameKey.current;
  }

  async function saveTitle() {
    if (pending) return;
    const parsed = noteTitleSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      titleField.current?.focus();
      return;
    }
    if (parsed.data === title) {
      closeRename();
      return;
    }
    setPending(true);
    let result;
    try {
      result = await renameNote({ id: note.id, title: parsed.data });
    } catch {
      result = null;
    }
    setPending(false);
    if (!result || !result.ok) {
      setError(result ? failureReason(result) : COPY.checkConnection);
      titleField.current?.focus();
      return;
    }
    announce(COPY.renamed(result.data.title ?? parsed.data));
    closeRename();
  }

  function changeArea(value: string) {
    if (value === areaId) return;
    startTransition(async () => {
      setOptimisticArea(value);
      let result;
      try {
        result = await setNoteArea({ id: note.id, areaId: value === NO_AREA ? null : value });
      } catch {
        result = null;
      }
      if (result?.ok) {
        announce(COPY.areaChanged(title));
        return;
      }
      toaster.push({
        title: COPY.notSavedTitle,
        text: `${COPY.notSaved.area} ${result ? failureReason(result) : COPY.checkConnection}`,
        tone: "error",
      });
    });
  }

  function togglePin() {
    const next = !pinned;
    startTransition(async () => {
      setOptimisticPinned(next);
      let result;
      try {
        result = await pinNote({ id: note.id, pinned: next });
      } catch {
        result = null;
      }
      if (result?.ok) {
        announce(next ? COPY.pinnedText(title) : COPY.unpinnedText(title));
        return;
      }
      toaster.push({
        title: COPY.notSavedTitle,
        text: `${COPY.notSaved.pin} ${result ? failureReason(result) : COPY.checkConnection}`,
        tone: "error",
      });
    });
  }

  return (
    <header className="flex flex-col gap-4">
      <h1 id={headingId} tabIndex={-1} className="bo-text-display break-words outline-none">
        {title}
      </h1>
      {renaming ? (
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void saveTitle();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closeRename();
          }}
        >
          <TextField
            ref={titleField}
            label={COPY.titleLabel}
            value={draft}
            maxLength={NOTE_TITLE_MAX_LENGTH * 2}
            error={error}
            data-note-title-field=""
            onChange={(event) => {
              setDraft(event.target.value);
              setError(undefined);
            }}
            onBlur={(event) => setDraft(normalizeName(event.target.value))}
          />
          <div className="flex flex-wrap gap-2">
            <Key type="submit" variant="signal" aria-disabled={pending || undefined}>
              {COPY.renameSave}
            </Key>
            <Key variant="ghost" onClick={closeRename}>
              {COPY.renameCancel}
            </Key>
          </div>
        </form>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        {renaming ? null : (
          <Key
            ref={renameKey}
            variant="ghost"
            icon={Pencil}
            data-note-rename=""
            onClick={openRename}
          >
            {COPY.rename}
          </Key>
        )}
        <Key variant="ghost" icon={pinned ? PinOff : Pin} data-note-pin="" onClick={togglePin}>
          {pinned ? COPY.unpin : COPY.pin}
        </Key>
        <div className="min-w-48">
          <AreaSelect
            id={`${ids}-area`}
            label={COPY.areaLabel}
            areas={areas}
            kept={note.area}
            value={areaId}
            onValueChange={changeArea}
          />
        </div>
      </div>
    </header>
  );
}
