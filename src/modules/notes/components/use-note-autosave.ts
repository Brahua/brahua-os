"use client";

// The autosave of a note's body (SPEC-notes "Guardado", "Versión"): 1 s after the last key press,
// when the field loses focus and when the page is hidden or left (`visibilitychange`, `pagehide`).
// One save in flight and only the newest one waiting (src/lib/use-save-queue.ts), each sending the
// text and the version as they are when its turn comes. A save that finds another version is a
// conflict: autosave stops, the text stays as a draft, and the owner picks «Ver la versión
// guardada» or «Quedarme con la mía». A failed save is tried again on the next key press, when
// the field loses focus, when the browser is back `online`, when the page is visible again, or
// with «Reintentar». Every timer and listener is cleared on unmount.
//
// Screen readers (decisión autónoma para revisar con el owner): «Guardando…» and «Guardado» are
// only visual. The polite announcer says «Sin guardar: …» once per reason (not again on every
// pause with the same problem), «Guardado» when a save recovers from a failure, and «Guardado»
// when the owner closes the editor («Listo» or Esc: `announceWhenSaved`).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { normalizeNotes } from "@/lib/markdown-text";
import { useSaveQueue } from "@/lib/use-save-queue";
import { saveDailyNote, saveNote } from "../actions";
import { NOTES_COPY as COPY } from "../copy";
import { NOTE_BODY_MAX_LENGTH, NOTE_SAVE_DELAY_MS } from "../note-constants";
import type { SavedNote, SaveResult } from "../note-input";

/** What the server holds, as far as this screen knows. `id` null: a day without a note yet. */
export type KnownNote = { id: string | null; body: string; version: number };

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  /** `key` names the reason for the announcer (the same problem is said once). */
  | { kind: "failed"; reason: string; key: string };

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
  /** The screen's polite announcer. */
  announce: (message: string) => void;
};

export function useNoteAutosave({ initial, day, announce }: Options) {
  const enqueue = useSaveQueue();
  const [text, setTextState] = useState(initial.body);
  const [known, setKnownState] = useState<KnownNote>(initial);
  const [status, setStatusState] = useState<SaveStatus>({ kind: "idle" });
  const [conflict, setConflictState] = useState<SavedNote | null>(null);
  /** The local text kept aside after «Ver la versión guardada». */
  const [draft, setDraft] = useState<string | null>(null);

  // Mirrors read by saves that run later (a queued call reads them when its turn comes).
  const textRef = useRef(initial.body);
  const knownRef = useRef<KnownNote>(initial);
  const conflictRef = useRef<SavedNote | null>(null);
  const statusRef = useRef<SaveStatus>({ kind: "idle" });
  const timer = useRef<number | undefined>(undefined);
  const stopped = useRef(false);
  /** The reason last announced (cleared by a save that lands). */
  const announcedFailure = useRef<string | null>(null);
  /** «Listo» or Esc while a save was pending: say «Guardado» when it lands. */
  const sayWhenSaved = useRef(false);
  const announceRef = useRef(announce);
  useEffect(() => {
    announceRef.current = announce;
  });

  const setKnown = useCallback((next: KnownNote) => {
    knownRef.current = next;
    setKnownState(next);
  }, []);
  const setConflict = useCallback((next: SavedNote | null) => {
    conflictRef.current = next;
    setConflictState(next);
  }, []);
  const setStatus = useCallback((next: SaveStatus) => {
    const before = statusRef.current;
    statusRef.current = next;
    setStatusState(next);
    if (next.kind === "failed") {
      sayWhenSaved.current = false;
      if (announcedFailure.current !== next.key) {
        announcedFailure.current = next.key;
        announceRef.current(COPY.unsaved(next.reason));
      }
      return;
    }
    if (next.kind === "saved") {
      const recovered = before.kind === "failed" || announcedFailure.current !== null;
      announcedFailure.current = null;
      if (recovered || sayWhenSaved.current) announceRef.current(COPY.saved);
      sayWhenSaved.current = false;
    }
  }, []);

  const clearTimer = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    if (stopped.current || conflictRef.current) return;
    if (!differsFrom(textRef.current, knownRef.current.body)) return;
    const length = normalizeNotes(textRef.current).length;
    if (length > NOTE_BODY_MAX_LENGTH) {
      setStatus({
        kind: "failed",
        reason: COPY.overLimit(length, NOTE_BODY_MAX_LENGTH),
        key: "overLimit",
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
        // A network failure or a new deployment: the text stays; see the header for retries.
        setStatus({ kind: "failed", reason: COPY.checkConnection, key: "connection" });
        return;
      }
      const result = queued.value;
      if (result === null) {
        if (queued.superseded) return;
        setStatus(conflictRef.current ? { kind: "idle" } : { kind: "saved" });
        return;
      }
      if (!result.ok) {
        const reason = failureReason(result);
        setStatus({ kind: "failed", reason, key: reason });
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
        setKnown({ id: data.id, body: data.body, version: data.version });
      }
      // Another save is coming (newer text): it decides what the indicator says.
      if (queued.superseded || differsFrom(textRef.current, knownRef.current.body)) return;
      setStatus({ kind: "saved" });
    })();
  }, [clearTimer, day, enqueue, setConflict, setKnown, setStatus]);

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

  /**
   * Saves what is pending now and resolves once every save on its way has landed (or failed):
   * nothing typed is lost before something like a delete.
   */
  const settle = useCallback(async () => {
    flush();
    await enqueue(null, async () => undefined);
  }, [enqueue, flush]);

  /** «Listo» or Esc: saves what is pending and says «Guardado» once it is (or now, if it was). */
  const announceWhenSaved = useCallback(() => {
    const pending = !conflictRef.current && differsFrom(textRef.current, knownRef.current.body);
    if (pending) {
      flush();
      // The save may have failed at once (over the limit): then the failure was said instead.
      if (statusRef.current.kind === "saving") sayWhenSaved.current = true;
      return;
    }
    if (statusRef.current.kind === "saving") sayWhenSaved.current = true;
    else if (statusRef.current.kind === "saved") announceRef.current(COPY.saved);
  }, [flush]);

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
  }, [setConflict, setKnown, setStatus]);

  const discardDraft = useCallback(() => setDraft(null), []);

  /** The note's id as the last save left it (read after `settle`, when state may lag). */
  const currentId = useCallback(() => knownRef.current.id, []);

  /**
   * N3: what a line action (convert, its «Deshacer») may act on, read after `settle`: the note as
   * the server holds it, or null when the screen isn't in step with it (no note yet, a conflict,
   * text not saved, or saving stopped). Then the action isn't sent.
   */
  const inStep = useCallback((): (KnownNote & { id: string }) | null => {
    const target = knownRef.current;
    if (stopped.current || conflictRef.current || target.id === null) return null;
    if (differsFrom(textRef.current, target.body)) return null;
    return { ...target, id: target.id };
  }, []);

  /**
   * N3: a line action changed the note on the server (a new body and version). With nothing
   * pending, the screen takes it as the saved text. If something was typed meanwhile, it is a
   * conflict like any other («Cambió en otro dispositivo»): the typed text stays as the draft and is
   * never sent over the new version by itself.
   */
  const adopt = useCallback(
    (saved: SavedNote) => {
      const pending =
        conflictRef.current !== null || differsFrom(textRef.current, knownRef.current.body);
      if (pending) {
        clearTimer();
        setConflict(saved);
        setStatus({ kind: "idle" });
        return;
      }
      setKnown({ ...saved });
      textRef.current = saved.body;
      setTextState(saved.body);
    },
    [clearTimer, setConflict, setKnown, setStatus],
  );

  /** No more saves (the note was deleted). */
  const stop = useCallback(() => {
    stopped.current = true;
    clearTimer();
  }, [clearTimer]);

  // Hidden or left: save what is pending (best effort: the browser may not wait). Visible again or
  // back online: try again what is pending (a failed save among it).
  useEffect(() => {
    function onVisibility() {
      flush();
    }
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", flush);
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

  // A draft kept aside is unsaved too: leaving asks until «Descartar borrador».
  const dirty = conflict !== null || draft !== null || differsFrom(text, known.body);

  return {
    text,
    setText,
    flush,
    settle,
    currentId,
    inStep,
    adopt,
    announceWhenSaved,
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
