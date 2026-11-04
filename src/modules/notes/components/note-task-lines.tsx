"use client";

// N3 (SPEC-notes "Línea → tarea", "Casilla de tarea"): the controls the view draws on task list
// items, and the logic behind them, which lives in `NoteBody` (it owns the autosave):
//
// - «Convertir en tarea» after an unchecked item: first what is pending lands (`settle`), then the
//   action is sent only if the screen is in step with the server (no conflict, nothing unsaved);
//   the new body and version come back and the editor takes them (`adopt`), so the next save
//   never meets a false conflict. Its notice has «Deshacer» (the line comes back and the untouched
//   task goes, only if the note is still at the version the conversion left).
// - The checkbox before a `[[task:…]]` item: the task's real state (the server's resolution),
//   optimistic while saving, rolled back if the save fails. Marking it completes the task with
//   `tasks`' own completion (recurrence included) and its notice has «Deshacer»; unmarking it is
//   `tasks`' own undo of a completion. A task that is gone has no box (the renderer).
//
// The actions come from src/lib/note-task-actions.ts through the page (props), never imported:
// `notes` doesn't import `tasks`.
import { ListPlus } from "lucide-react";
import { createContext, use, useEffect, useOptimistic, useRef, useTransition } from "react";
import { Key } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { NOTES_COPY as COPY } from "../copy";
import type { ConvertedLine, NoteTaskToggled, RestoredLine } from "../note-input";

/** The Server Actions of the line controls (src/lib/note-task-actions.ts). */
export type NoteLineActions = {
  convert: (input: unknown) => Promise<ActionResult<ConvertedLine>>;
  undoConvert: (input: unknown) => Promise<ActionResult<RestoredLine>>;
  complete: (input: unknown) => Promise<ActionResult<NoteTaskToggled>>;
  reopen: (input: unknown) => Promise<ActionResult<NoteTaskToggled>>;
};

/** What the controls read from the editor around them. */
export type NoteLines = {
  /** Whether a line may be converted now (the note exists and isn't in a conflict). */
  canConvert: boolean;
  /** A conversion (or its «Deshacer») is on its way. */
  converting: boolean;
  convert: (item: { index: number; text: string }) => void;
  /** Marks (`done`) or unmarks a task; true once the server agreed. */
  toggle: (task: { id: string; name: string }, done: boolean) => Promise<boolean>;
  /** A task's state as the last answer from the server left it, if this screen changed it. */
  doneOf: (id: string) => boolean | undefined;
  /**
   * True once for the task whose checkbox should take the focus when it shows (the line just
   * converted: its key is gone). The checkbox asks when it mounts (the editor's text may render
   * a moment later, once its Markdown code has loaded).
   */
  claimFocus: (id: string) => boolean;
};

export const NoteLinesContext = createContext<NoteLines | null>(null);

/** Marks the controls, so a tap on them never opens the editor (the view's tap-to-edit). */
export const LINE_CONTROL = "data-note-line-control";

/** «Convertir en tarea», after an unchecked item that can become a task. */
export function ConvertLineKey({ index, text }: { index: number; text: string }) {
  const lines = use(NoteLinesContext);
  if (!lines) return null;
  const unavailable = !lines.canConvert || lines.converting;
  return (
    <Key
      variant="ghost"
      size="sm"
      icon={ListPlus}
      className="bo-md-task-convert"
      aria-label={COPY.convertLabel(text)}
      aria-disabled={unavailable || undefined}
      data-note-convert={index}
      {...{ [LINE_CONTROL]: "" }}
      onClick={() => {
        if (!unavailable) lines.convert({ index, text });
      }}
    >
      {COPY.convert}
    </Key>
  );
}

/**
 * The real checkbox of a `[[task:…]]` item. `done` is the server's resolution; null when nobody
 * looked the task up yet (a link typed in the editor): then no box, only the link.
 */
export function NoteTaskCheckbox({
  id,
  name,
  done,
}: {
  id: string;
  name: string;
  done: boolean | null;
}) {
  const lines = use(NoteLinesContext);
  const known = lines?.doneOf(id) ?? done;
  const [shown, setShown] = useOptimistic(known ?? false);
  const [pending, startTransition] = useTransition();
  const box = useRef<HTMLInputElement>(null);
  const visible = lines !== null && known !== null;
  useEffect(() => {
    if (visible && lines?.claimFocus(id)) box.current?.focus();
  }, [visible, lines, id]);
  if (!lines || known === null) return null;
  return (
    // A label: the whole 44 px square toggles the 20 px box.
    <label className="bo-md-task-check" {...{ [LINE_CONTROL]: "" }}>
      <input
        ref={box}
        type="checkbox"
        className="bo-milestone-check"
        checked={shown}
        aria-label={COPY.taskDoneLabel(name)}
        // Never `disabled` while saving (it would drop the focus): a guard instead.
        aria-disabled={pending || undefined}
        data-note-task-check={id}
        onChange={(event) => {
          if (pending) return;
          const next = event.target.checked;
          startTransition(async () => {
            setShown(next);
            // A failure leaves `known` as it was: the box goes back when the transition ends.
            await lines.toggle({ id, name }, next);
          });
        }}
      />
    </label>
  );
}
