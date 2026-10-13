"use client";

import Link from "next/link";
import {
  startTransition,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Key } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { formatDateKey } from "@/lib/time";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { taskViewHref } from "@/modules/tasks/routes";
import type { MoveTasksResult, MovedTask, WeekReviewOpenTask } from "@/modules/tasks/contracts";
import { moveReviewTasks, undoReviewMove } from "../actions";
import { PENDIENTES_COPY as COPY, REVIEW_COPY } from "../review-copy";

/** How long a row takes to fade out before it leaves (not under reduced motion). */
export const LEAVE_FADE_MS = 180;

type StepPendientesProps = {
  /** The Lima day the page was read for (the earliest day «Otro día…» offers). */
  today: string;
  /** Where «Mover las N al lunes» and «Mañana» land (`moveTargets`). */
  targets: { monday: string; tomorrow: string };
  /** The open tasks (at most 200), the oldest day first. */
  open: readonly WeekReviewOpenTask[];
  /** The real number of open tasks (more than `open` when the list is cut). */
  openCount: number;
  /** Pending tasks in the inbox. */
  inboxCount: number;
};

const without = (set: ReadonlySet<string>, ids: readonly string[]) => {
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next;
};
const withAll = (set: ReadonlySet<string>, ids: readonly string[]) => new Set([...set, ...ids]);

/** The server's message for a failed result: a field's own when it gives one, else the general. */
function reasonOf(result: { ok: false; error: string; fieldErrors?: Record<string, string[]> }) {
  const own = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
  return own ?? result.error;
}

/**
 * Step 2 · Pendientes (SPEC-weekly-review "Pantallas"): «Quedaron abiertas N tareas.», the big key
 * «Mover las N al lunes» and each task with «Mañana · Otro día… · Dejar».
 *
 * - Moves are optimistic: the rows fade out (not under reduced motion) and leave at once; the
 *   save runs in the screen's queue (src/lib/use-save-queue.ts) and a refusal brings them back
 *   with «Sin guardar». A second press on a task already moving does nothing (a guard, plus
 *   `aria-disabled`: a focused key is never `disabled`).
 * - «Se movieron N tareas · Deshacer» carries ONLY what the contract says moved (never what it
 *   skipped) and `undoMoveTasks` puts back only the tasks still on the day the move gave them.
 * - «Dejar» keeps a task out of «Mover las N al lunes» (a mark on this screen, nothing is saved).
 * - Focus: a key that leaves with its row hands focus to the next row's «Mañana» (or the one
 *   before, or the empty-state message). Timers are cleared on unmount.
 */
export function StepPendientes({
  today,
  targets,
  open,
  openCount,
  inboxCount,
}: StepPendientesProps) {
  const { toaster, enqueue, announce, isCurrentDay } = useRequiredScreenServices();
  const { push } = toaster;
  const reducedMotion = usePrefersReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  /** Tasks moved on this screen (hidden until the page reads again, or an undo). */
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  /** Tasks fading out. */
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  /** «Dejar»: tasks that stay where they are (out of the batch). */
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  /** Tasks with a save in flight (`aria-disabled`). */
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const inflight = useRef(new Set<string>());
  const timers = useRef(new Set<number>());
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const rows = useMemo(() => open.filter((task) => !gone.has(task.id)), [open, gone]);
  const total = Math.max(0, openCount - (open.length - rows.length));
  const batchSize = rows.filter((task) => !left.has(task.id)).length;
  const tomorrowLabel = formatDateKey(targets.tomorrow, "short");

  // After rows left: focus goes where the key that was pressed has no row to be in.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    root.current?.querySelector<HTMLElement>(`[data-review-focus="${target}"]`)?.focus();
  }, [gone]);

  function release(ids: readonly string[]) {
    for (const id of ids) inflight.current.delete(id);
    setSaving((current) => without(current, ids));
  }

  function notSaved(text: string, reason: string) {
    push({ title: REVIEW_COPY.notSavedTitle, text: `${text} ${reason}`.trim(), tone: "error" });
  }

  /** Fades the rows out, then runs `run` (at once under reduced motion). */
  function leave(ids: readonly string[], run: () => void) {
    if (reducedMotion) {
      run();
      return;
    }
    setLeaving((current) => withAll(current, ids));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, LEAVE_FADE_MS);
    timers.current.add(timer);
  }

  function moveRows(batch: readonly WeekReviewOpenTask[], to: string) {
    if (isCurrentDay && !isCurrentDay()) return;
    const fresh = batch.filter((task) => !inflight.current.has(task.id) && !gone.has(task.id));
    if (fresh.length === 0) return;
    const ids = fresh.map((task) => task.id);
    for (const id of ids) inflight.current.add(id);
    setSaving((current) => withAll(current, ids));

    const remaining = rows.filter((task) => !ids.includes(task.id));
    const at = rows.findIndex((task) => task.id === ids[0]);
    const neighbor = fresh.length === 1 ? (remaining[at] ?? remaining[at - 1]) : remaining[0];
    const focusKey = neighbor ? `row:${neighbor.id}` : "empty";

    leave(ids, () => {
      pendingFocus.current = focusKey;
      setGone((current) => withAll(current, ids));
      setLeaving((current) => without(current, ids));
      startTransition(async () => {
        const queued = await enqueue(null, () =>
          moveReviewTasks({
            moves: fresh.map((task) => ({ id: task.id, from: task.dueDate })),
            to,
          }),
        );
        release(ids);
        const result: ActionResult<MoveTasksResult> =
          queued.kind === "done" ? queued.value : fail(REVIEW_COPY.checkConnection);
        if (!result.ok) {
          // Rolled back: they are open again, and it says so.
          setGone((current) => without(current, ids));
          notSaved(COPY.notMoved, reasonOf(result));
          return;
        }
        const { moved, skipped } = result.data;
        // What the contract left alone is still where it was: the page decides what shows.
        if (skipped.length > 0) {
          setGone((current) =>
            without(
              current,
              skipped.map((entry) => entry.id),
            ),
          );
        }
        if (moved.length === 0) {
          push({ title: COPY.movedTitle, text: COPY.nothingMoved });
          return;
        }
        push({
          title: COPY.movedTitle,
          text: `${COPY.moved(moved.length)}${skipped.length > 0 ? ` ${COPY.stayed(skipped.length)}` : ""}`,
          action: { label: REVIEW_COPY.undo, run: () => undoMove(moved) },
        });
      });
    });
  }

  function undoMove(moved: readonly MovedTask[]) {
    // Only what moved, with the day it had and the day the move gave it.
    const undo = moved.map(({ id, previousDueDate, movedTo }) => ({
      id,
      previousDueDate,
      movedTo,
    }));
    startTransition(async () => {
      const queued = await enqueue(null, () => undoReviewMove({ undo }));
      const result = queued.kind === "done" ? queued.value : fail(REVIEW_COPY.checkConnection);
      if (!result.ok) {
        notSaved(COPY.notUndone, reasonOf(result));
        return;
      }
      const { restored, kept, missing } = result.data;
      // The page reads again with the truth; until then nothing stays hidden by this screen.
      setGone((current) =>
        without(
          current,
          undo.map((entry) => entry.id),
        ),
      );
      const notRestored = kept.length + missing.length;
      if (notRestored === 0) {
        announce(COPY.undone(restored.length));
      } else {
        push({
          title: COPY.movedTitle,
          text:
            restored.length === 0
              ? COPY.notRestored(notRestored)
              : COPY.undonePartial(restored.length, notRestored),
        });
      }
    });
  }

  function toggleLeft(id: string, on: boolean) {
    setLeft((current) => (on ? withAll(current, [id]) : without(current, [id])));
  }

  return (
    <div ref={root} className="flex flex-col gap-5" data-review-step="pendientes">
      {rows.length > 0 ? (
        <>
          <p className="bo-text-body" data-open-count="">
            {COPY.open(total)}
          </p>
          {openCount > open.length ? (
            <p className="bo-text-body-sm text-text-secondary">
              {COPY.shownOf(open.length, openCount)}
            </p>
          ) : null}
          <div className="flex max-w-160 flex-col gap-2">
            <Key
              variant="signal"
              size="lg"
              block
              aria-disabled={batchSize === 0 || undefined}
              data-review-focus="batch"
              data-review-batch=""
              onClick={() => {
                if (batchSize === 0) return;
                moveRows(
                  rows.filter((task) => !left.has(task.id)),
                  targets.monday,
                );
              }}
            >
              {batchSize === 0 ? COPY.moveAllNone : COPY.moveAll(batchSize)}
            </Key>
            <p className="bo-text-body-sm text-text-secondary">{COPY.moveAllHelp}</p>
          </div>
          <ul className="flex max-w-160 flex-col gap-2" data-review-rows="">
            {rows.map((task) => (
              <PendingRow
                key={task.id}
                task={task}
                today={today}
                tomorrow={targets.tomorrow}
                tomorrowLabel={tomorrowLabel}
                leaving={leaving.has(task.id)}
                busy={leaving.has(task.id) || saving.has(task.id)}
                left={left.has(task.id)}
                onLeft={(on) => toggleLeft(task.id, on)}
                onMove={(day) => moveRows([task], day)}
              />
            ))}
          </ul>
        </>
      ) : (
        <div className="flex max-w-160 flex-col gap-1">
          <p
            className="bo-text-title outline-none"
            tabIndex={-1}
            data-review-focus="empty"
            data-review-empty=""
          >
            {COPY.emptyTitle}
          </p>
          <p className="bo-text-body-sm text-text-secondary">{COPY.emptyText}</p>
        </div>
      )}

      {inboxCount > 0 ? (
        <p className="bo-text-body-sm" data-review-inbox="">
          {COPY.inbox(inboxCount)} ·{" "}
          <Link
            href={taskViewHref("bandeja")}
            aria-label={COPY.inboxName(inboxCount)}
            className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {COPY.inboxProcess}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

type PendingRowProps = {
  task: WeekReviewOpenTask;
  today: string;
  tomorrow: string;
  tomorrowLabel: string;
  leaving: boolean;
  busy: boolean;
  left: boolean;
  onLeft: (on: boolean) => void;
  onMove: (day: string) => void;
};

/** One open task: its title and day, and «Mañana · Otro día… · Dejar» (48 px keys). */
function PendingRow({
  task,
  today,
  tomorrow,
  tomorrowLabel,
  leaving,
  busy,
  left,
  onLeft,
  onMove,
}: PendingRowProps) {
  const [picking, setPicking] = useState(false);
  const pickKey = useRef<HTMLButtonElement>(null);
  const meta = [COPY.dueOn(formatDateKey(task.dueDate, "short")), task.projectName]
    .filter(Boolean)
    .join(" · ");

  function closePicker() {
    setPicking(false);
    pickKey.current?.focus();
  }

  return (
    <li
      data-review-row={task.id}
      data-leaving={leaving ? "" : undefined}
      data-left={left ? "" : undefined}
      className="bo-card bo-review-row gap-2"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="bo-text-body min-w-0 font-medium break-words">{task.title}</p>
        <p className="bo-text-label text-text-secondary">{meta}</p>
        {task.recurring ? (
          <p className="bo-text-label text-text-secondary">{COPY.recurring}</p>
        ) : null}
        {left ? <p className="bo-text-body-sm text-text-secondary">{COPY.leftNote}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Key
          variant="ghost"
          aria-label={COPY.tomorrowName(task.title, tomorrowLabel)}
          aria-disabled={busy || undefined}
          data-review-focus={`row:${task.id}`}
          onClick={() => {
            if (!busy) onMove(tomorrow);
          }}
        >
          {COPY.tomorrow}
        </Key>
        <Key
          ref={pickKey}
          variant="ghost"
          aria-label={COPY.pickName(task.title)}
          aria-expanded={picking}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) setPicking(true);
          }}
        >
          {COPY.pick}
        </Key>
        <Key
          variant="ghost"
          toggle
          pressed={left}
          aria-label={COPY.leaveName(task.title)}
          aria-disabled={busy || undefined}
          onPressedChange={(on) => {
            if (!busy) onLeft(on);
          }}
        >
          {COPY.leave}
        </Key>
      </div>
      {picking ? (
        <OtherDayForm
          title={task.title}
          min={today}
          initial={tomorrow}
          onCancel={closePicker}
          onSubmit={(day) => {
            setPicking(false);
            onMove(day);
          }}
        />
      ) : null}
    </li>
  );
}

type OtherDayFormProps = {
  title: string;
  /** The earliest day (YYYY-MM-DD): today. */
  min: string;
  initial: string;
  onCancel: () => void;
  onSubmit: (day: string) => void;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** «Otro día…»: a native date field in the row (Enter moves, Escape cancels). */
function OtherDayForm({ title, min, initial, onCancel, onSubmit }: OtherDayFormProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [day, setDay] = useState(initial);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    input.current?.focus();
  }, []);

  return (
    <form
      noValidate
      aria-label={COPY.pickName(title)}
      className="flex flex-col gap-2 border-t border-divider pt-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const real = DAY.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));
        if (!real || day < min) {
          setError(COPY.dayHelp);
          input.current?.focus();
          return;
        }
        onSubmit(day);
      }}
    >
      <div className={`bo-field${error ? " is-error" : ""}`}>
        <label className="bo-field__label" htmlFor={`${id}-day`}>
          {COPY.dayLabel}
        </label>
        <input
          ref={input}
          id={`${id}-day`}
          type="date"
          min={min}
          value={day}
          className="bo-field__control"
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            setDay(event.target.value);
            setError(undefined);
          }}
        />
        <span id={`${id}-help`} className={error ? "bo-field__error" : "bo-field__help"}>
          {COPY.dayHelp}
        </span>
      </div>
      <div className="flex gap-2">
        <Key type="submit" variant="signal">
          {COPY.moveDay}
        </Key>
        <Key variant="ghost" onClick={onCancel}>
          {COPY.cancel}
        </Key>
      </div>
    </form>
  );
}
