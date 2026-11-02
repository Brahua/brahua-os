"use client";

import { Clock, Trash2 } from "lucide-react";
import { useEffect, useId, useOptimistic, useRef, useState } from "react";
import { IconKey, Key, SectionLabel } from "@/design-system";
import { LEARNING_COPY } from "../learning-copy";
import { SESSION_WEEKS_SHOWN } from "../learning-constants";
import { formatMinutes, mondayOf } from "../pace";
import { removeSession, restoreSession } from "../sessions-actions";
import { SESSIONS_COPY as COPY } from "../sessions-copy";
import type { SessionItem } from "../sessions-input";
import { clockTime, dayLabel, groupByWeek, relativeDay, sessionDay } from "../sessions-view";
import { LogSessionSheet } from "./session-sheets";
import { useLearningSave } from "./use-learning-save";

type SessionsSectionProps = {
  track: { id: string; title: string };
  /** The track's ended sessions of the last weeks, newest first. */
  sessions: SessionItem[];
  /** Lima's today (YYYY-MM-DD). */
  today: string;
};

/** How long a focus request waits for its element to render (the server's list after an undo). */
const FOCUS_WAIT_MS = 3_000;

/** The clock of focus requests (read in event handlers and effects, never while rendering). */
const clock = () => performance.now();

const removeKey = (id: string) =>
  document.querySelector<HTMLElement>(`[data-session-remove="${CSS.escape(id)}"]`);

/**
 * «Sesiones» of a track's page (SPEC-learning "Detalle"): «Anotar tiempo» and the sessions of the
 * last weeks grouped by Lima week with their totals, each one with «Quitar» (at once, with an exact
 * «Deshacer»).
 */
export function SessionsSection({ track, sessions: serverSessions, today }: SessionsSectionProps) {
  const { save, toaster, announce, saving } = useLearningSave();
  const headingId = useId();
  const [sessions, hide] = useOptimistic(serverSessions, (list: SessionItem[], id: string) =>
    list.filter((session) => session.id !== id),
  );
  const weeks = groupByWeek(sessions);
  const thisWeek = mondayOf(today);
  const [logOpen, setLogOpen] = useState(false);
  const [logKey, setLogKey] = useState(0);
  const logButton = useRef<HTMLButtonElement>(null);
  const logged = useRef<{ session: SessionItem; day: string } | null>(null);

  // Element to focus after a render (a row went away or came back). One that isn't there yet is
  // looked for again on the next renders, for a short while.
  const focusRequest = useRef<{ find: () => HTMLElement | null; at: number } | null>(null);
  function requestFocus(find: () => HTMLElement | null) {
    focusRequest.current = { find, at: clock() };
  }
  useEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    const element = request.find();
    if (element) {
      focusRequest.current = null;
      element.focus();
    } else if (clock() - request.at > FOCUS_WAIT_MS) {
      focusRequest.current = null;
    }
  });

  function remove(session: SessionItem) {
    // Focus goes to the next row's «Quitar» (or the previous one's, or «Anotar tiempo»).
    const index = sessions.findIndex((item) => item.id === session.id);
    const neighbor = sessions[index + 1] ?? sessions[index - 1] ?? null;
    requestFocus(() => (neighbor ? removeKey(neighbor.id) : logButton.current));
    save<SessionItem>({
      apply: () => hide(session.id),
      key: `session:${session.id}`,
      call: () => removeSession({ trackId: track.id, id: session.id }),
      failure: COPY.notSaved.remove,
      onSuccess: () =>
        toaster.push({
          title: COPY.removedTitle,
          text: COPY.removed(session.minutes),
          action: { label: LEARNING_COPY.undo, run: () => restore(session) },
        }),
      onFailure: () => {
        requestFocus(() => removeKey(session.id));
      },
    });
  }

  function restore(session: SessionItem) {
    save<SessionItem>({
      key: `session:${session.id}`,
      call: () => restoreSession({ trackId: track.id, id: session.id }),
      failure: LEARNING_COPY.notUndone,
      onSuccess: () => {
        announce(COPY.restored(session.minutes));
        requestFocus(() => removeKey(session.id));
      },
    });
  }

  function logClosed() {
    const saved = logged.current;
    logged.current = null;
    if (!saved) return;
    const { session, day } = saved;
    toaster.push({
      title: COPY.loggedTitle,
      text: COPY.logged(session.minutes, track.title, relativeDay(day, today)),
      action: {
        label: LEARNING_COPY.undo,
        run: () =>
          save({
            key: `session:${session.id}`,
            call: () => removeSession({ trackId: track.id, id: session.id }),
            failure: LEARNING_COPY.notUndone,
            onSuccess: () =>
              toaster.push({
                title: LEARNING_COPY.undoneTitle,
                text: LEARNING_COPY.statusRestored,
              }),
          }),
      },
    });
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex max-w-160 flex-col gap-4"
      data-sessions=""
      data-saving={saving || undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel id={headingId} as="h2" title={COPY.title} />
        <Key
          ref={logButton}
          variant="ghost"
          icon={Clock}
          data-session-log=""
          onClick={() => {
            setLogKey((key) => key + 1);
            setLogOpen(true);
          }}
        >
          {COPY.log}
        </Key>
      </div>

      {weeks.length === 0 ? (
        <p className="bo-text-body-sm text-text-secondary" data-sessions-empty="">
          {COPY.empty}
        </p>
      ) : (
        <>
          {weeks.map((week) => {
            const label =
              week.weekStart === thisWeek ? COPY.thisWeek : COPY.weekOf(week.weekStart, today);
            return (
              <div
                key={week.weekStart}
                className="flex flex-col gap-2"
                data-session-week={week.weekStart}
              >
                <h3
                  className="bo-text-label flex items-baseline justify-between gap-3 text-text-secondary"
                  aria-label={COPY.weekName(label, week.minutes)}
                >
                  <span>{label}</span>
                  <span className="tabular-nums">{COPY.weekTotal(week.minutes)}</span>
                </h3>
                <ul aria-label={label} className="bo-list">
                  {week.sessions.map((session) => {
                    const day = dayLabel(sessionDay(session), today);
                    return (
                      <li
                        key={session.id}
                        data-session-row={session.id}
                        className="flex min-w-0 items-center justify-between gap-3 bg-surface px-4 py-2"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="bo-text-body">{day}</span>
                          <span className="bo-text-body-sm text-text-secondary">
                            {session.source === "manual"
                              ? COPY.manual
                              : COPY.span(clockTime(session.startedAt), clockTime(session.endedAt))}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="bo-text-body tabular-nums">
                            {formatMinutes(session.minutes)}
                          </span>
                          <IconKey
                            variant="ghost"
                            icon={Trash2}
                            label={COPY.removeName(session.minutes, day)}
                            placement="top"
                            data-session-remove={session.id}
                            onClick={() => remove(session)}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <p className="bo-text-body-sm text-text-secondary">
            {COPY.shownWeeks(SESSION_WEEKS_SHOWN)}
          </p>
        </>
      )}

      <LogSessionSheet
        key={logKey}
        open={logOpen}
        onOpenChange={setLogOpen}
        returnFocusRef={logButton}
        track={track}
        today={today}
        onSaved={(session, day) => {
          logged.current = { session, day };
        }}
        onClosed={logClosed}
      />
    </section>
  );
}
