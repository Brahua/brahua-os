"use client";

// The autosave of a note's body (SPEC-notes "Guardado", "Versión"): 1 s after the last key press,
// when the field loses focus and when the page is hidden or left (`visibilitychange`, `pagehide`).
// One save in flight and only the newest one waiting (src/lib/use-save-queue.ts), each sending the
// text and the version as they are when its turn comes. A save that finds another version is a
// conflict: autosave stops, the text stays as a draft, and the owner picks «Ver la versión
// guardada» or «Quedarme con la mía». Every timer and listener is cleared on unmount.
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeNotes } from "@/lib/markdown-text";
import { useSaveQueue } from "@/lib/use-save-queue";
import { saveDailyNote, saveNote } from "../actions";
import { NOTES_COPY as COPY } from "../copy";
import { NOTE_BODY_MAX_LENGTH, NOTE_SAVE_DELAY_MS } from "../note-constants";
import type { SavedNote, SaveResult } from "../note-input";
import type { ActionResult } from "@/lib/action-result";

/** What the server holds, as far as this screen knows. `id` null: a day without a note yet. */
export type KnownNote = { id: string | null; body: string; version: number };

export type SaveStatus =
  { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; reason: string };

/** The server's message for a failed result: a field's own when it gives one, else the general. */
export function failureReason(result: {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
}): string {
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

/** Whether `text` differs from what is stored once normalized as the server stores it. */
export function differsFrom(text: string, saved: string): boolean {
  return normalizeNotes(text) !== saved;
}

type Options = {
  /** The note as the page read it. */
  initial: KnownNote;
  /** A daily note's day (its first save creates it); null for a knowledge note. */
  day: string | null;
  /** Called once a save created the day's note or wrote a new version (e.g. to show «Eliminar»). */
  onSaved?: (note: SavedNote) => void;
};

export function useNoteAutosave({ initial, day, onSaved }: Options) {
  const enqueue = useSaveQueue();
  const [text, setTextState] = useState(initial.body);
  const [known, setKnownState] = useState<KnownNote>(initial);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [conflict, setConflictState] = useState<SavedNote | null>(null);
  /** The local text kept aside after «Ver la versión guardada». */
  const [draft, setDraft] = useState<string | null>(null);

  // Mirrors read by saves that run later (a queued call reads them when its turn comes).
  const textRef = useRef(initial.body);
  const knownRef = useRef<KnownNote>(initial);
  const conflictRef = useRef<SavedNote | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const stopped = useRef(false);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const setKnown = useCallback((next: KnownNote) => {
    knownRef.current = next;
    setKnownState(next);
  }, []);
  const setConflict = useCallback((next: SavedNote | null) => {
    conflictRef.current = next;
    setConflictState(next);
  }, []);

  const clearTimer = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    if (stopped.current || conflictRef.current) return;
    if (!differsFrom(textRef.current, knownRef.current.body)) return;
    if (normalizeNotes(textRef.current).length > NOTE_BODY_MAX_LENGTH) {
      setStatus({
        kind: "failed",
        reason: COPY.overLimit(normalizeNotes(textRef.current).length, NOTE_BODY_MAX_LENGTH),
      });
      return;
    }
    setStatus({ kind: "saving" });
    void (async () => {
      const queued = await enqueue("body", async () => {
        // Read at the turn of this call: the newest text and the version the last save left.
        const body = textRef.current;
        const target = knownRef.current;
        if (stopped.current || conflictRef.current || !differsFrom(body, target.body)) return null;
        const result: ActionResult<SaveResult> =
          target.id === null
            ? await saveDailyNote({ day, body })
            : await saveNote({ id: target.id, body, version: target.version });
        return result;
      });
      if (queued.kind === "skipped" || stopped.current) return;
      if (queued.kind === "threw") {
        // A network failure or a new deployment: the text stays, the next key press tries again.
        setStatus({ kind: "failed", reason: COPY.checkConnection });
        return;
      }
      const result = queued.value;
      if (result === null) {
        if (!queued.superseded)
          setStatus(conflictRef.current ? { kind: "idle" } : { kind: "saved" });
        return;
      }
      if (!result.ok) {
        setStatus({ kind: "failed", reason: failureReason(result) });
        return;
      }
      const data = result.data;
      if (data.status === "conflict") {
        clearTimer();
        setConflict(data.current);
        setStatus({ kind: "idle" });
        return;
      }
      if (data.status === "saved") {
        const saved = { id: data.id, body: data.body, version: data.version };
        setKnown(saved);
        onSavedRef.current?.(saved);
      }
      // Another save is coming (newer text): it decides what the indicator says.
      if (queued.superseded || differsFrom(textRef.current, knownRef.current.body)) return;
      setStatus({ kind: "saved" });
    })();
  }, [clearTimer, day, enqueue, setConflict, setKnown]);

  const setText = useCallback(
    (value: string) => {
      textRef.current = value;
      setTextState(value);
      clearTimer();
      if (conflictRef.current || stopped.current) return;
      timer.current = window.setTimeout(flush, NOTE_SAVE_DELAY_MS);
    },
    [clearTimer, flush],
  );

  /** «Quedarme con la mía»: the local text overwrites the version that is stored now. */
  const keepMine = useCallback(() => {
    const current = conflictRef.current;
    if (!current) return;
    setKnown({ ...current });
    setConflict(null);
    flush();
  }, [flush, setConflict, setKnown]);

  /** «Ver la versión guardada»: the stored text comes in; the local one stays aside as a draft. */
  const viewSaved = useCallback(() => {
    const current = conflictRef.current;
    if (!current) return;
    setDraft(textRef.current);
    setKnown({ ...current });
    setConflict(null);
    textRef.current = current.body;
    setTextState(current.body);
    setStatus({ kind: "idle" });
  }, [setConflict, setKnown]);

  const discardDraft = useCallback(() => setDraft(null), []);

  /** No more saves (the note is being deleted). */
  const stop = useCallback(() => {
    stopped.current = true;
    clearTimer();
  }, [clearTimer]);

  // Leaving or hiding the page saves what is pending (best effort: the browser may not wait).
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") flush();
    }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  // Unmounted (another page): save what is pending and clear the timer.
  useEffect(
    () => () => {
      flush();
      window.clearTimeout(timer.current);
    },
    [flush],
  );

  const dirty = conflict !== null || differsFrom(text, known.body);

  return {
    text,
    setText,
    flush,
    known,
    status,
    conflict,
    draft,
    dirty,
    keepMine,
    viewSaved,
    discardDraft,
    stop,
  };
}
