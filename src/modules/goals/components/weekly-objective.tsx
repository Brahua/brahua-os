"use client";

import { Pencil, Plus } from "lucide-react";
import { useId, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Key, TextField } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { formatDateKey } from "@/lib/time";
import { clearWeeklyObjective, setWeeklyObjective, undoWeeklyObjective } from "../actions";
import { GOALS_COPY } from "../goals-copy";
import {
  weekEnd,
  weeklyTextSchema,
  type WeeklyObjectiveChange,
  type WeeklyObjectiveUndo,
} from "../weekly-input";
import { failureReason, useGoalsScreen } from "./goals-screen";

type WeeklyObjectiveProps = {
  /** The Monday of the week the page was read for (Lima). */
  weekStart: string;
  /** That week's objective as saved, or null (a new week starts empty). */
  objective: string | null;
};

/**
 * "Esta semana" (SPEC-goals "Pantallas"): the week's objective, editable in one tap. Viewing, one
 * key opens an inline field (focus goes to it); Enter saves and Escape cancels, and either way focus
 * comes back to that key. Saving is optimistic through the screen's queue, with a "Deshacer"
 * notice that puts back exactly the text it replaced (or the absence). An empty save clears the
 * week. A failed save says so and reopens the field with what was typed.
 */
export function WeeklyObjective({ weekStart, objective }: WeeklyObjectiveProps) {
  const { enqueue, toaster, announce, isCurrentDay } = useGoalsScreen();
  const { push } = toaster;
  const [shown, apply] = useOptimistic(objective, (_current, next: string | null) => next);
  const [, startSaving] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const opener = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // Set when the field closes: focus then returns to the opener, which is mounted again.
  const restoreFocus = useRef(false);
  const titleId = useId();

  useLayoutEffect(() => {
    if (editing) {
      field.current?.focus();
      field.current?.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      opener.current?.focus();
    }
  }, [editing]);

  function open() {
    setDraft(shown ?? "");
    setError(undefined);
    setEditing(true);
  }

  function close() {
    restoreFocus.current = true;
    setEditing(false);
  }

  function notSaved(text: string, reason: string) {
    push({ title: GOALS_COPY.notSavedTitle, text: `${text} ${reason}`, tone: "error" });
  }

  /** Runs `call` through the queue; returns its data, or null after saying why it failed. */
  async function run<T>(
    key: string | null,
    call: () => Promise<ActionResult<T>>,
    failed: string,
  ): Promise<{ data: T } | null> {
    const queued = await enqueue(key, call);
    // Skipped (a newer save of the same field took its place) or replaced: nothing to report.
    if (queued.kind === "skipped" || queued.superseded) return null;
    const result = queued.kind === "done" ? queued.value : fail<T>(GOALS_COPY.checkConnection);
    if (!result.ok) {
      notSaved(failed, failureReason(result));
      return null;
    }
    return { data: result.data };
  }

  function noticeFor(change: WeeklyObjectiveChange) {
    push({
      title: GOALS_COPY.weekSavedTitle,
      text: change.text === null ? GOALS_COPY.weekCleared : GOALS_COPY.weekSaved(change.text),
      action: { label: GOALS_COPY.undo, run: () => undo(change) },
    });
  }

  function save(text: string) {
    if (!isCurrentDay()) return;
    startSaving(async () => {
      apply(text);
      const done = await run<WeeklyObjectiveChange>(
        "weekly-objective",
        () => setWeeklyObjective({ weekStart, text }),
        GOALS_COPY.weekNotSaved,
      );
      if (!done) {
        // Keep what was typed: the field opens again with it.
        setDraft(text);
        setEditing(true);
        return;
      }
      noticeFor(done.data);
    });
  }

  function clear() {
    if (!isCurrentDay()) return;
    startSaving(async () => {
      apply(null);
      const done = await run<WeeklyObjectiveChange>(
        "weekly-objective",
        () => clearWeeklyObjective({ weekStart }),
        GOALS_COPY.weekNotSaved,
      );
      if (done) noticeFor(done.data);
    });
  }

  /** "Deshacer": the exact text it carries, only while the week still holds what the change left. */
  function undo(change: WeeklyObjectiveChange) {
    if (!isCurrentDay()) return;
    startSaving(async () => {
      apply(change.previous);
      const done = await run<WeeklyObjectiveUndo>(
        null,
        () =>
          undoWeeklyObjective({
            weekStart: change.weekStart,
            previous: change.previous,
            applied: change.text,
          }),
        GOALS_COPY.weekNotUndone,
      );
      if (!done) return;
      if (done.data.restored) announce(GOALS_COPY.weekRestored);
      else
        push({
          title: GOALS_COPY.weekSavedTitle,
          text: GOALS_COPY.weekUndoStale,
        });
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = draft.trim();
    if (typed === "") {
      // Nothing typed: an empty week stays empty; a set one is cleared (with its "Deshacer").
      close();
      if (shown !== null) clear();
      return;
    }
    const parsed = weeklyTextSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    close();
    if (parsed.data !== shown) save(parsed.data);
  }

  return (
    <section
      aria-labelledby={titleId}
      className="bo-card max-w-160 items-stretch gap-3"
      data-weekly-objective=""
    >
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="bo-text-title">
          {GOALS_COPY.weekTitle}
        </h2>
        <p className="bo-text-label text-text-secondary">
          {GOALS_COPY.weekRange(
            formatDateKey(weekStart, "short"),
            formatDateKey(weekEnd(weekStart), "short"),
          )}
        </p>
      </div>
      {editing ? (
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <TextField
            ref={field}
            label={GOALS_COPY.weekField}
            name="weekly-objective"
            value={draft}
            autoComplete="off"
            enterKeyHint="done"
            error={error}
            help={GOALS_COPY.weekFieldHelp}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Key type="submit" variant="signal">
              {GOALS_COPY.weekSave}
            </Key>
            <Key variant="ghost" onClick={close}>
              {GOALS_COPY.weekCancel}
            </Key>
            {shown !== null ? (
              <Key
                variant="ghost"
                onClick={() => {
                  close();
                  clear();
                }}
              >
                {GOALS_COPY.weekClear}
              </Key>
            ) : null}
          </div>
        </form>
      ) : shown !== null ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="bo-text-body min-w-0 flex-1 break-words" data-weekly-text="">
            {shown}
          </p>
          <Key
            ref={opener}
            variant="ghost"
            icon={Pencil}
            aria-label={GOALS_COPY.weekEdit}
            onClick={open}
          >
            {GOALS_COPY.edit}
          </Key>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="bo-text-body-sm text-text-secondary">{GOALS_COPY.weekEmptyHelp}</p>
          <Key ref={opener} icon={Plus} onClick={open}>
            {GOALS_COPY.weekSetObjective}
          </Key>
        </div>
      )}
    </section>
  );
}
