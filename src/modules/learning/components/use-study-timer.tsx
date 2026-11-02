"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { LEARNING_COPY } from "../learning-copy";
import { elapsedMs, needsConfirmation } from "../pace";
import { startSession, stopSession, undoStartSession, undoStopSession } from "../sessions-actions";
import { SESSIONS_COPY as COPY } from "../sessions-copy";
import type { RunningSession, StartResult, StoppedSession } from "../sessions-input";
import { ConfirmMinutesSheet } from "./session-sheets";
import { failureReason, useLearningSave } from "./use-learning-save";

type TrackRef = { id: string; title: string };

/** The «¿Cuánto estudiaste?» sheet: for a plain stop, or to stop before starting another track. */
type Confirm = { session: RunningSession; ranMinutes: number; then: TrackRef | null };

const PENDING_ID = "pending";

/** Milliseconds a timer has run now (read in event handlers, never while rendering). */
const ranMs = (session: RunningSession) => elapsedMs(session.startedAt, Date.now());

/** Whole minutes a timer has run now. */
const ranMinutes = (session: RunningSession) => Math.ceil(ranMs(session) / 60_000);

/**
 * The timer of a screen (SPEC-learning "Cronómetro"), shared by every «Estudiar» on it (the list's
 * cards, a track's page; L3's card in Hoy). `running` is the server's running session, shown
 * optimistically: «Estudiar» runs at once, «Detener» stops at once, and a refusal or a network
 * failure rolls back with a notice that says why. Starting a track while another one runs stops
 * and saves that one in the same request. A timer that ran more than 4 h opens «¿Cuánto
 * estudiaste?» before anything is saved. Every change has an exact «Deshacer». Render `sheet`.
 */
export function useStudyTimer(serverRunning: RunningSession | null) {
  const { send, toaster } = useLearningSave();
  const [running, setRunning] = useOptimistic(
    serverRunning,
    (_: RunningSession | null, next: RunningSession | null) => next,
  );
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmKey, setConfirmKey] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const busy = pending || confirmOpen;

  function notSaved(failure: string, result: { ok: false; error: string }) {
    toaster.push({
      title: LEARNING_COPY.notSavedTitle,
      text: `${failure} ${failureReason(result)}`,
      tone: "error",
    });
  }

  /** Sends a call (optimistic `next` first, when given) and handles its answer. */
  function run<T>(
    next: RunningSession | null | undefined,
    call: () => Promise<ActionResult<T>>,
    failure: string,
    onOk: (data: T) => void,
    onRefused?: (result: {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
    }) => boolean,
  ) {
    startTransition(async () => {
      if (next !== undefined) setRunning(next);
      const result = await send(call);
      if (result.ok) {
        onOk(result.data);
        return;
      }
      if (onRefused?.(result)) return;
      notSaved(failure, result);
    });
  }

  function openConfirm(session: RunningSession, then: TrackRef | null, from: HTMLElement | null) {
    opener.current = from;
    setConfirm({ session, ranMinutes: ranMinutes(session), then });
    setConfirmKey((key) => key + 1);
    setConfirmOpen(true);
  }

  function startedNotice(result: StartResult) {
    const { session, stopped } = result;
    toaster.push({
      title: COPY.startedTitle,
      text: stopped
        ? COPY.switched(stopped.trackTitle, stopped.minutes, session.trackTitle)
        : COPY.started(session.trackTitle),
      action: { label: LEARNING_COPY.undo, run: () => undoStart(result) },
    });
  }

  function stoppedNotice(stopped: StoppedSession) {
    toaster.push({
      title: COPY.stoppedTitle,
      text: COPY.stopped(stopped.minutes, stopped.trackTitle),
      action: { label: LEARNING_COPY.undo, run: () => undoStop(stopped) },
    });
  }

  /** «Estudiar» on `track` (`from` gets focus back after a confirmation sheet). */
  function start(track: TrackRef, from: HTMLElement | null) {
    if (busy || running?.trackId === track.id) return;
    if (running && needsConfirmation(ranMs(running))) {
      openConfirm(running, track, from);
      return;
    }
    const current = running;
    run<StartResult>(
      {
        id: PENDING_ID,
        trackId: track.id,
        trackTitle: track.title,
        startedAt: new Date().toISOString(),
      },
      () => startSession({ trackId: track.id }),
      COPY.notSaved.start,
      startedNotice,
      (result) => {
        // The server's clock says the other timer ran more than 4 h: ask first.
        if (!result.fieldErrors?.stopMinutes || !current) return false;
        openConfirm(current, track, from);
        return true;
      },
    );
  }

  /** «Detener» the running timer. */
  function stop(from: HTMLElement | null) {
    const session = running;
    if (busy || !session || session.id === PENDING_ID) return;
    if (needsConfirmation(ranMs(session))) {
      openConfirm(session, null, from);
      return;
    }
    run<StoppedSession>(
      null,
      () => stopSession({ id: session.id }),
      COPY.notSaved.stop,
      stoppedNotice,
      (result) => {
        if (!result.fieldErrors?.minutes) return false;
        openConfirm(session, null, from);
        return true;
      },
    );
  }

  function undoStart({ session, stopped }: StartResult) {
    run(
      undefined,
      () =>
        undoStartSession({
          id: session.id,
          stopped: stopped
            ? { id: stopped.id, endedAt: stopped.endedAt, minutes: stopped.minutes }
            : null,
        }),
      LEARNING_COPY.notUndone,
      () => toaster.push({ title: LEARNING_COPY.undoneTitle, text: LEARNING_COPY.statusRestored }),
    );
  }

  function undoStop(stopped: StoppedSession) {
    run(
      undefined,
      () => undoStopSession({ id: stopped.id, endedAt: stopped.endedAt, minutes: stopped.minutes }),
      LEARNING_COPY.notUndone,
      () => toaster.push({ title: LEARNING_COPY.undoneTitle, text: LEARNING_COPY.statusRestored }),
    );
  }

  /** The confirmed minutes: stop, or stop and start the track that asked. */
  async function confirmMinutes(minutes: number): Promise<ActionResult<unknown>> {
    if (!confirm) return { ok: false, error: LEARNING_COPY.checkConnection };
    if (confirm.then) {
      const then = confirm.then;
      const result = await send(() => startSession({ trackId: then.id, stopMinutes: minutes }));
      if (result.ok) startedNotice(result.data);
      return result;
    }
    const id = confirm.session.id;
    const result = await send(() => stopSession({ id, minutes }));
    if (result.ok) stoppedNotice(result.data);
    return result;
  }

  const sheet = confirm ? (
    <ConfirmMinutesSheet
      key={confirmKey}
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      returnFocusRef={opener}
      trackTitle={confirm.session.trackTitle}
      ranMinutes={confirm.ranMinutes}
      onConfirm={confirmMinutes}
    />
  ) : null;

  return { running, busy, start, stop, sheet };
}
