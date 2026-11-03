"use client";

import { useEffect, useRef } from "react";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { restoreNote } from "../actions";
import { NOTES_COPY as COPY } from "../copy";
import { dailyTitle } from "../note-day";
import type { DeletedNote } from "../note-input";
import { DELETED_PARAM } from "../routes";
import { failureReason } from "./use-note-autosave";

/** A live region only speaks what changes after it is on the page. */
const ANNOUNCE_DELAY_MS = 150;

type NoteDeletedNoticeProps = {
  /** Id of the page's `<h1 tabIndex={-1}>`: focus lands there after a delete. */
  headingId: string;
  /** The note just deleted from its page (`?deleted=<id>`), while it is still deleted. */
  deleted: DeletedNote | null;
  /** Lima's today (a daily note is named by its date). */
  today: string;
};

/**
 * After deleting a note from its page, the page sends here with `?deleted=<id>`: focus goes to the
 * heading, the parameter leaves the URL (a reload doesn't repeat it) and «Nota eliminada ·
 * Deshacer» shows in the screen's notices. «Deshacer» restores exactly that note (by its id).
 */
export function NoteDeletedNotice({ headingId, deleted, today }: NoteDeletedNoticeProps) {
  const { toaster } = useRequiredScreenServices();
  const { push } = toaster;
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!deleted || shown.current === deleted.id) return;
    const note = deleted;
    const name =
      note.kind === "daily" && note.day ? dailyTitle(note.day, today) : (note.title ?? "");
    document.getElementById(headingId)?.focus();
    const url = new URL(window.location.href);
    if (url.searchParams.has(DELETED_PARAM)) {
      url.searchParams.delete(DELETED_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }

    async function undo() {
      let result;
      try {
        result = await restoreNote({ id: note.id });
      } catch {
        result = null;
      }
      if (result?.ok) {
        push({ title: COPY.undoneTitle, text: COPY.restored(name) });
        return;
      }
      push({
        title: COPY.notSavedTitle,
        text: `${COPY.notUndone} ${result ? failureReason(result) : COPY.checkConnection}`,
        tone: "error",
      });
    }

    const timer = window.setTimeout(() => {
      shown.current = note.id;
      push({
        title: COPY.deletedTitle,
        text: COPY.deleted(name),
        action: { label: COPY.undo, run: () => void undo() },
      });
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deleted, headingId, push, today]);

  return null;
}
