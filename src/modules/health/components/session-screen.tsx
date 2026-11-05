"use client";

import { ArrowDownUp, Check, Clock, Flag, Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { Key, TextArea, TextField } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { celebrate } from "@/lib/celebrate";
import { hasNotice } from "@/lib/toast/queue";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { useSecondClock } from "@/lib/use-second-clock";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { applyOrder, moveId } from "@/modules/core/life-area-order";
import type { ExerciseItem } from "../exercises-input";
import { formatDuration } from "../format";
import { MAX_SESSION_EXERCISES } from "../health-constants";
import { HEALTH_COPY } from "../health-copy";
import { fillFollowing, prefillSets } from "../prefill";
import type { SessionRecord } from "../records";
import { RECORDS_COPY } from "../records-copy";
import { SETTINGS_COPY } from "../settings-copy";
import { writeRest } from "../rest-timer";
import { DELETED_PARAM, SESSIONS_PATH } from "../routes";
import { ROUTINES_COPY } from "../routines-copy";
import {
  formatElapsed,
  formatMinutes,
  formatSessionDay,
  formatTimeOfDay,
  fromLimaInput,
  minutesBetween,
  toLimaInput,
} from "../session-time";
import {
  addHealthSet,
  addSessionExercise,
  deleteHealthSession,
  finishHealthSession,
  readHealthSessionRecords,
  removeHealthSet,
  removeSessionExercise,
  reorderSessionExercises,
  restoreHealthSet,
  restoreSessionExercise,
  undoFinishHealthSession,
  updateHealthSet,
  updateSessionNote,
  updateSessionTimes,
} from "../sessions-actions";
import { SESSION_ERRORS, SESSIONS_COPY as COPY } from "../sessions-copy";
import {
  keepShown,
  sessionNoteSchema,
  type FinishResult,
  type SessionDetail,
  type SessionExercise,
  type SessionSet,
  type SetValues,
} from "../sessions-input";
import { ExerciseBlock, restOf, type SetHandlers } from "./exercise-block";
import { ExerciseFormSheet } from "./exercise-form-sheet";
import { ExercisePickerSheet } from "./exercise-picker-sheet";
import { FinishSheet } from "./finish-sheet";
import {
  OrderListContext,
  PlainOrderRows,
  type OrderItem,
  type OrderListProps,
} from "./order-rows";
import { RestBar, useRestTimer } from "./rest-bar";
import { SessionRecords } from "./session-records";
import { useFocusRequest } from "./use-focus-request";
import { failureReason } from "./use-health-save";

// dnd-kit only loads in the browser, after the page (as in E1's lists).
const SortableRows = dynamic(() => import("./sortable-rows"), {
  ssr: false,
  loading: () => <PlainOrderRows />,
});

type Failure = { ok: false; error: string; fieldErrors?: Record<string, string[]> };

type SessionScreenProps = {
  session: SessionDetail;
  /** The live catalogue (the picker of «Agregar ejercicio»). */
  catalogue: ExerciseItem[];
  /** Id of the `<h1>`. */
  headingId: string;
  /** The new records of a finished session (E3): its summary counts and lists them. */
  records?: SessionRecord[];
};

const NO_RECORDS: SessionRecord[] = [];

type Header = Omit<SessionDetail, "exercises">;

function headerOf(session: SessionDetail): Header {
  const { exercises, ...header } = session;
  void exercises;
  return header;
}

const setValues = (set: SetValues): SetValues => ({
  weightGrams: set.weightGrams,
  reps: set.reps,
  seconds: set.seconds,
  distanceMeters: set.distanceMeters,
});

const renumber = <T extends { position: number }>(rows: T[]): T[] =>
  rows.map((row, index) => (row.position === index ? row : { ...row, position: index }));

/**
 * A session's screen (SPEC-health "Pantallas"), open or finished. It runs on its own state: every
 * change shows at once and is saved through the screen's queue, one call per change, and settles
 * with what the server answers (the actions never revalidate this page). A set whose save fails on
 * the network stays as typed with «Sin guardar» and «Reintentar»; a refusal rolls it back with a
 * notice that says why. Each write is persisted, so the session survives a reload.
 */
export function SessionScreen({
  session: initial,
  catalogue,
  headingId,
  records: initialRecords = NO_RECORDS,
}: SessionScreenProps) {
  const router = useRouter();
  const { enqueue, toaster, announce } = useRequiredScreenServices();
  const [saving, startTransition] = useTransition();
  const reducedMotion = usePrefersReducedMotion();
  const sessionId = initial.id;
  const [header, setHeader] = useState<Header>(() => headerOf(initial));
  const [exercises, setExercises] = useState<SessionExercise[]>(initial.exercises);
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(() => new Set());
  // Derived on the server (never stored): read again after a correction of a finished session.
  const [records, setRecords] = useState<SessionRecord[]>(initialRecords);
  const open = header.endedAt === null;
  const name = COPY.routineOrFree(header.routineName);

  // The last version of each set the server confirmed: a refusal rolls back to it.
  const confirmed = useRef(
    new Map(initial.exercises.flatMap((exercise) => exercise.sets.map((set) => [set.id, set]))),
  );
  // Sets whose «Añadir serie» never reached the server (a network failure): «Reintentar» adds them.
  const notCreated = useRef(new Set<string>());
  const latest = useRef(exercises);
  useLayoutEffect(() => {
    latest.current = exercises;
  });
  const noticeSerial = useRef(0);

  const timer = useRestTimer(sessionId, announce);
  const restFrom = useRef<string | null>(null);
  const restReturn = useCallback(
    () =>
      restFrom.current
        ? document.querySelector<HTMLElement>(`[data-set-check="${CSS.escape(restFrom.current)}"]`)
        : null,
    [],
  );

  // ── Focus after a render ─────────────────────────────────────────────────────────────────
  const requestFocus = useFocusRequest();
  const byData = (attribute: string, id: string) => () =>
    document.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(id)}"]`);

  // ── The queue ────────────────────────────────────────────────────────────────────────────

  function notSaved(failure: string, reason: string) {
    toaster.push({ title: HEALTH_COPY.notSavedTitle, text: `${failure} ${reason}`, tone: "error" });
  }

  /**
   * The records of a finished session after a write that may change them (a set, an exercise, the
   * times): queued behind that write, collapsed while one waits. A failed read keeps what is shown.
   */
  function refreshRecords() {
    void enqueue("records", () => readHealthSessionRecords({ sessionId })).then((queued) => {
      if (queued.kind === "done" && !queued.superseded && queued.value.ok) {
        setRecords(queued.value.data);
      }
    });
  }

  /**
   * Sends a call through the screen's queue (in order; with a `key`, a newer call of the same key
   * replaces one still waiting). `refused` and `threw` default to a «Sin guardar» notice.
   */
  function run<T>(
    key: string | null,
    call: () => Promise<ActionResult<T>>,
    {
      failure,
      done,
      refused,
      threw,
    }: {
      failure: string;
      done?: (data: T) => void;
      refused?: (result: Failure) => void;
      threw?: () => void;
    },
  ) {
    startTransition(async () => {
      const queued = await enqueue(key, call);
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        done?.(queued.value.data);
        if (!open && key !== "note") refreshRecords();
        return;
      }
      if (queued.kind === "done" && !queued.value.ok) {
        if (refused) refused(queued.value);
        else notSaved(failure, failureReason(queued.value));
        return;
      }
      if (threw) threw();
      else notSaved(failure, HEALTH_COPY.checkConnection);
    });
  }

  /** A call whose result the caller awaits (finish, discard, times). A throw becomes a failure. */
  async function send<T>(call: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
    const queued = await enqueue(null, call);
    if (queued.kind === "done") return queued.value;
    return { ok: false, error: HEALTH_COPY.checkConnection };
  }

  // ── Sets ─────────────────────────────────────────────────────────────────────────────────

  const mapSets = (exerciseId: string, update: (sets: SessionSet[]) => SessionSet[]) =>
    setExercises((list) =>
      list.map((exercise) =>
        exercise.id === exerciseId
          ? { ...exercise, sets: renumber(update(exercise.sets)) }
          : exercise,
      ),
    );

  const replaceSet = (row: SessionSet) =>
    setExercises((list) =>
      list.map((exercise) =>
        exercise.sets.some((set) => set.id === row.id)
          ? {
              ...exercise,
              sets: exercise.sets.map((set) =>
                set.id === row.id ? { ...row, position: set.position } : set,
              ),
            }
          : exercise,
      ),
    );

  // The same ids as `unsaved`, readable from callbacks that run after a render.
  const dirty = useRef(new Set<string>());
  /** Whether the screen holds a version of this set the server doesn't have. */
  const isDirty = (id: string) => dirty.current.has(id) || notCreated.current.has(id);

  /**
   * The server's sets of an exercise, keeping the screen's version of any set it holds unsaved
   * (and the ones never created there): an answer never wipes what the owner typed (CLAUDE.md
   * "household").
   */
  function mergeSets(local: readonly SessionSet[] | undefined, server: SessionSet[]): SessionSet[] {
    const mine = new Map((local ?? []).map((row) => [row.id, row]));
    const merged = server.map((row) => {
      const kept = mine.get(row.id);
      return kept && isDirty(row.id) ? { ...kept, position: row.position } : row;
    });
    const extra = (local ?? []).filter(
      (row) => notCreated.current.has(row.id) && !server.some((other) => other.id === row.id),
    );
    return [...merged, ...extra];
  }

  function confirm(rows: readonly SessionSet[]) {
    for (const row of rows) if (!isDirty(row.id)) confirmed.current.set(row.id, row);
  }

  const markUnsaved = (id: string, value: boolean) => {
    if (value) dirty.current.add(id);
    else dirty.current.delete(id);
    setUnsaved((current) => {
      if (current.has(id) === value) return current;
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  function networkNotice() {
    toaster.replace({
      id: "health-set-unsaved",
      title: COPY.unsaved,
      text: COPY.setUnsavedText,
      tone: "error",
    });
  }

  // Sets whose row holds text that doesn't parse (E5): never empty for the copy.
  const heldDrafts = useRef(new Set<string>());
  const onDraftHeld = useCallback((setId: string, held: boolean) => {
    if (held) heldDrafts.current.add(setId);
    else heldDrafts.current.delete(setId);
  }, []);

  /**
   * Saves a set. A `copy` (E5) that is refused rolls back under one shared notice, so a refusal of
   * several copies says it once.
   */
  function saveSet(next: SessionSet, { copy = false }: { copy?: boolean } = {}) {
    run(
      `set:${next.id}`,
      () =>
        updateHealthSet({
          sessionId,
          id: next.id,
          ...setValues(next),
          warmup: next.warmup,
          done: next.doneAt !== null,
        }),
      {
        failure: COPY.notSaved.set,
        done: (row) => {
          confirmed.current.set(row.id, row);
          markUnsaved(row.id, false);
          replaceSet(row);
        },
        refused: (result) => {
          markUnsaved(next.id, false);
          const back = confirmed.current.get(next.id);
          if (back) replaceSet(back);
          if (copy) {
            toaster.replace({
              id: "health-set-copy-refused",
              title: HEALTH_COPY.notSavedTitle,
              text: `${COPY.notSaved.copy} ${failureReason(result)}`,
              tone: "error",
            });
          } else {
            notSaved(COPY.notSaved.set, failureReason(result));
          }
        },
        threw: () => {
          markUnsaved(next.id, true);
          networkNotice();
        },
      },
    );
  }

  function findSet(id: string): { exercise: SessionExercise; set: SessionSet } | null {
    for (const exercise of latest.current) {
      const set = exercise.sets.find((row) => row.id === id);
      if (set) return { exercise, set };
    }
    return null;
  }

  function sendAdd(exerciseId: string, set: SessionSet) {
    run(
      null,
      () =>
        addHealthSet({
          sessionId,
          sessionExerciseId: exerciseId,
          id: set.id,
          ...setValues(set),
          warmup: set.warmup,
        }),
      {
        failure: COPY.notSaved.addSet,
        done: (row) => {
          notCreated.current.delete(row.id);
          confirmed.current.set(row.id, row);
          markUnsaved(row.id, false);
        },
        refused: (result) => {
          notCreated.current.delete(set.id);
          markUnsaved(set.id, false);
          mapSets(exerciseId, (sets) => sets.filter((row) => row.id !== set.id));
          notSaved(COPY.notSaved.addSet, failureReason(result));
        },
        threw: () => {
          notCreated.current.add(set.id);
          markUnsaved(set.id, true);
          networkNotice();
        },
      },
    );
  }

  const handlers: SetHandlers = {
    onValues: (_exercise, set, values) => {
      const next = { ...set, ...values };
      replaceSet(next);
      if (!notCreated.current.has(set.id)) saveSet(next);
    },
    onDone: (exercise, set, done, values) => {
      const next: SessionSet = {
        ...set,
        ...values,
        doneAt: done ? (set.doneAt ?? new Date().toISOString()) : null,
      };
      replaceSet(next);
      if (!notCreated.current.has(set.id)) saveSet(next);
      // E5: the following planned, empty sets take these values, each saved like an edit of its
      // own (`set:<id>` in the queue). Unmarking never clears them.
      const current = latest.current.find((row) => row.id === exercise.id) ?? exercise;
      const filled = done
        ? fillFollowing(
            exercise.kind,
            current.sets.map((row) => (row.id === next.id ? next : row)),
            next,
            heldDrafts.current,
          )
        : [];
      for (const row of filled) {
        replaceSet(row);
        if (!notCreated.current.has(row.id)) saveSet(row, { copy: true });
      }
      const setName = COPY.setName(
        exercise.sets.findIndex((row) => row.id === set.id),
        exercise.name,
      );
      // One announcement for the mark, the copies and the rest.
      const said = [
        COPY.marked(setName),
        filled.length > 0 ? COPY.valuesCopied(filled.length) : null,
      ];
      if (done && open) {
        const rest = restOf(exercise);
        // Focus stays on the checkbox (the bar never takes it) and comes back to it after.
        restFrom.current = set.id;
        timer.start(rest);
        announce([...said, COPY.restStarted(formatDuration(rest))].filter(Boolean).join(" "));
      } else if (done) {
        announce(said.filter(Boolean).join(" "));
      }
    },
    onWarmup: (_exercise, set, warmup) => {
      const next = { ...set, warmup };
      replaceSet(next);
      if (!notCreated.current.has(set.id)) saveSet(next);
    },
    onRetry: (set) => {
      const found = findSet(set.id);
      if (!found) return;
      if (notCreated.current.has(set.id)) {
        sendAdd(found.exercise.id, found.set);
        // What changed after the failed add (values, marked, warmup) goes right behind it: if the
        // add did reach the server with older values, its idempotent retry returns those.
        saveSet(found.set);
      } else {
        saveSet(found.set);
      }
    },
    onAddSet: (exercise) => {
      const last = exercise.sets.at(-1);
      const base = last ? setValues(last) : prefillSets(exercise.previous, 1)[0];
      const set: SessionSet = {
        id: crypto.randomUUID(),
        position: exercise.sets.length,
        ...keepShown(exercise.kind, base),
        warmup: false,
        doneAt: null,
      };
      mapSets(exercise.id, (sets) => [...sets, set]);
      sendAdd(exercise.id, set);
    },
    onDraftHeld,
    onRemoveSet: (exercise, set) => removeSet(exercise, set),
    onRemoveExercise: (exercise) => removeExercise(exercise),
  };

  function removeSet(exercise: SessionExercise, set: SessionSet) {
    const position = exercise.sets.findIndex((row) => row.id === set.id);
    if (position === -1) return;
    const afterId = exercise.sets[position - 1]?.id ?? null;
    const neighbour = exercise.sets[position + 1] ?? exercise.sets[position - 1];
    const setName = COPY.setName(position, exercise.name);
    mapSets(exercise.id, (sets) => sets.filter((row) => row.id !== set.id));
    markUnsaved(set.id, false);
    requestFocus(
      neighbour ? byData("data-set-menu", neighbour.id) : byData("data-add-set", exercise.id),
    );
    if (notCreated.current.has(set.id)) {
      // It never reached the server: nothing to remove there.
      notCreated.current.delete(set.id);
      return;
    }
    const noticeId = toaster.push({
      id: `set-remove-${set.id}-${++noticeSerial.current}`,
      title: COPY.setRemovedTitle,
      text: COPY.setRemoved(setName),
      action: {
        label: HEALTH_COPY.undo,
        run: () => undoRemoveSet(exercise, set, position, afterId),
      },
    });
    const putBack = () =>
      mapSets(exercise.id, (sets) => {
        if (sets.some((row) => row.id === set.id)) return sets;
        const next = [...sets];
        next.splice(Math.min(position, next.length), 0, set);
        return next;
      });
    run(null, () => removeHealthSet({ sessionId, id: set.id }), {
      failure: COPY.notSaved.removeSet,
      refused: (result) => {
        toaster.dismiss(noticeId);
        putBack();
        notSaved(COPY.notSaved.removeSet, failureReason(result));
      },
      threw: () => {
        toaster.dismiss(noticeId);
        putBack();
        notSaved(COPY.notSaved.removeSet, HEALTH_COPY.checkConnection);
      },
    });
  }

  function undoRemoveSet(
    exercise: SessionExercise,
    set: SessionSet,
    position: number,
    afterId: string | null,
  ) {
    mapSets(exercise.id, (sets) => {
      if (sets.some((row) => row.id === set.id)) return sets;
      const next = [...sets];
      const anchor = afterId ? next.findIndex((row) => row.id === afterId) : -1;
      next.splice(anchor !== -1 ? anchor + 1 : Math.min(position, next.length), 0, set);
      return next;
    });
    const takeOut = () => mapSets(exercise.id, (sets) => sets.filter((row) => row.id !== set.id));
    run(null, () => restoreHealthSet({ sessionId, id: set.id, afterId, position }), {
      failure: HEALTH_COPY.notUndone,
      done: (sets) => {
        confirm(sets);
        mapSets(exercise.id, (current) => mergeSets(current, sets));
        toaster.push({ title: HEALTH_COPY.undoneTitle, text: COPY.setRestored(exercise.name) });
      },
      refused: (result) => {
        takeOut();
        notSaved(HEALTH_COPY.notUndone, failureReason(result));
      },
      threw: () => {
        takeOut();
        notSaved(HEALTH_COPY.notUndone, HEALTH_COPY.checkConnection);
      },
    });
  }

  // ── Exercises ────────────────────────────────────────────────────────────────────────────

  const addKey = useRef<HTMLButtonElement>(null);
  const [picker, setPicker] = useState({ key: 0, open: false });
  const [creator, setCreator] = useState({ key: 0, open: false, name: "" });
  const pendingCreate = useRef<string | null>(null);
  const full = exercises.length >= MAX_SESSION_EXERCISES;

  function addExercise(item: ExerciseItem) {
    if (latest.current.length >= MAX_SESSION_EXERCISES) {
      notSaved(COPY.notSaved.add, SESSION_ERRORS.tooManyExercises);
      return;
    }
    run(
      null,
      () => addSessionExercise({ sessionId, id: crypto.randomUUID(), exerciseId: item.id }),
      {
        failure: COPY.notSaved.add,
        done: (exercise) => {
          for (const set of exercise.sets) confirmed.current.set(set.id, set);
          setExercises((list) =>
            renumber([...list.filter((row) => row.id !== exercise.id), exercise]),
          );
          announce(COPY.exerciseAdded(item.name));
        },
      },
    );
  }

  function removeExercise(exercise: SessionExercise) {
    const position = exercises.findIndex((row) => row.id === exercise.id);
    if (position === -1) return;
    const afterId = exercises[position - 1]?.id ?? null;
    const neighbour = exercises[position + 1] ?? exercises[position - 1];
    setExercises((list) => renumber(list.filter((row) => row.id !== exercise.id)));
    requestFocus(neighbour ? byData("data-exercise-menu", neighbour.id) : () => addKey.current);
    const noticeId = toaster.push({
      id: `exercise-remove-${exercise.id}-${++noticeSerial.current}`,
      title: COPY.exerciseRemovedTitle,
      text: COPY.exerciseRemoved(exercise.name),
      action: {
        label: HEALTH_COPY.undo,
        run: () => undoRemoveExercise(exercise, position, afterId),
      },
    });
    const putBack = () =>
      setExercises((list) => {
        if (list.some((row) => row.id === exercise.id)) return list;
        const next = [...list];
        next.splice(Math.min(position, next.length), 0, exercise);
        return renumber(next);
      });
    run(null, () => removeSessionExercise({ sessionId, id: exercise.id }), {
      failure: COPY.notSaved.remove,
      refused: (result) => {
        toaster.dismiss(noticeId);
        putBack();
        notSaved(COPY.notSaved.remove, failureReason(result));
      },
      threw: () => {
        toaster.dismiss(noticeId);
        putBack();
        notSaved(COPY.notSaved.remove, HEALTH_COPY.checkConnection);
      },
    });
  }

  function undoRemoveExercise(exercise: SessionExercise, position: number, afterId: string | null) {
    setExercises((list) => {
      if (list.some((row) => row.id === exercise.id)) return list;
      const next = [...list];
      const anchor = afterId ? next.findIndex((row) => row.id === afterId) : -1;
      next.splice(anchor !== -1 ? anchor + 1 : Math.min(position, next.length), 0, exercise);
      return renumber(next);
    });
    const takeOut = () =>
      setExercises((list) => renumber(list.filter((row) => row.id !== exercise.id)));
    run(null, () => restoreSessionExercise({ sessionId, id: exercise.id, afterId, position }), {
      failure: HEALTH_COPY.notUndone,
      done: (list) => {
        for (const row of list) confirm(row.sets);
        setExercises((current) =>
          list.map((row) => ({
            ...row,
            sets: mergeSets(current.find((local) => local.id === row.id)?.sets, row.sets),
          })),
        );
        toaster.push({
          title: HEALTH_COPY.undoneTitle,
          text: COPY.exerciseRestored(exercise.name),
        });
      },
      refused: (result) => {
        takeOut();
        notSaved(HEALTH_COPY.notUndone, failureReason(result));
      },
      threw: () => {
        takeOut();
        notSaved(HEALTH_COPY.notUndone, HEALTH_COPY.checkConnection);
      },
    });
  }

  // ── Reorder ──────────────────────────────────────────────────────────────────────────────

  const [ordering, setOrdering] = useState(false);
  const orderKey = useRef<HTMLButtonElement>(null);
  const reorderBurst = useRef<{ noticeId: string; before: string[]; moves: number } | null>(null);

  function sendOrder(ids: string[], failure: string, onDone?: () => void, onFail?: () => void) {
    const before = latest.current.map((row) => row.id);
    setExercises((list) => renumber(applyOrder(list, ids)));
    run(null, () => reorderSessionExercises({ sessionId, ids }), {
      failure,
      done: () => onDone?.(),
      refused: (result) => {
        if (onFail?.() === undefined) {
          setExercises((list) => renumber(applyOrder(list, before)));
          notSaved(failure, failureReason(result));
        }
      },
      threw: () => {
        if (onFail?.() === undefined) {
          setExercises((list) => renumber(applyOrder(list, before)));
          notSaved(failure, HEALTH_COPY.checkConnection);
        }
      },
    });
  }

  function move(id: string, to: number) {
    const ids = exercises.map((row) => row.id);
    const from = ids.indexOf(id);
    if (from === -1 || from === to) return;
    const order = moveId(ids, from, to);
    const current = reorderBurst.current;
    const burst =
      current && hasNotice(toaster.state, current.noticeId)
        ? current
        : { noticeId: `session-order-${++noticeSerial.current}`, before: ids, moves: 0 };
    reorderBurst.current = burst;
    burst.moves += 1;
    toaster.replace({
      id: burst.noticeId,
      title: COPY.orderTitle,
      text: ROUTINES_COPY.moved(exercises[from].name, ROUTINES_COPY.position(to, order.length)),
      action: { label: HEALTH_COPY.undo, run: () => restoreOrder(burst.before) },
    });
    sendOrder(order, COPY.notSaved.reorder);
  }

  function restoreOrder(before: string[]) {
    reorderBurst.current = null;
    const ids = applyOrder(latest.current, before).map((row) => row.id);
    sendOrder(ids, HEALTH_COPY.notUndone, () =>
      toaster.push({ title: HEALTH_COPY.undoneTitle, text: COPY.orderRestored }),
    );
  }

  type Row = OrderItem & { id: string };
  const orderRows: Row[] = exercises.map((row) => ({ id: row.id, name: row.name }));
  const listProps: OrderListProps<Row> = {
    items: orderRows,
    label: COPY.orderLabel,
    dragRole: COPY.dragRole,
    reducedMotion,
    onMove: move,
    renderContent: (item) => (
      <span className="bo-text-body min-w-0 flex-1 px-2 py-2 break-words">{item.name}</span>
    ),
  };
  const list = listProps as unknown as OrderListProps<OrderItem>;

  // ── Note ─────────────────────────────────────────────────────────────────────────────────

  const noteId = useId();
  const [note, setNote] = useState(header.note ?? "");
  const [noteError, setNoteError] = useState<string | undefined>();

  function saveNote() {
    const parsed = sessionNoteSchema.safeParse(note);
    if (!parsed.success) {
      setNoteError(parsed.error.issues[0]?.message);
      return;
    }
    if (parsed.data === header.note) return;
    setHeader((current) => ({ ...current, note: parsed.data }));
    run("note", () => updateSessionNote({ sessionId, note: parsed.data }), {
      failure: COPY.notSaved.note,
      done: () => announce(COPY.noteSaved),
    });
  }

  // ── Finish, discard, delete ──────────────────────────────────────────────────────────────

  const finishKey = useRef<HTMLButtonElement>(null);
  const [finishSheet, setFinishSheet] = useState({ key: 0, open: false, openedAt: 0 });
  const [busy, setBusy] = useState(false);
  const doneAts = exercises.flatMap((row) =>
    row.sets.flatMap((set) => (set.doneAt === null ? [] : [set.doneAt])),
  );
  const planned = exercises.reduce(
    (total, row) => total + row.sets.filter((set) => set.doneAt === null).length,
    0,
  );

  function adopt(detail: SessionDetail) {
    for (const row of detail.exercises) confirm(row.sets);
    setHeader(headerOf(detail));
    setExercises((current) =>
      detail.exercises.map((row) => ({
        ...row,
        sets: mergeSets(current.find((local) => local.id === row.id)?.sets, row.sets),
      })),
    );
    setNote(detail.note ?? "");
  }

  /** «Reintentar» of every set the server doesn't have (the finish sheet's). */
  function retryAll() {
    for (const id of [...dirty.current, ...notCreated.current]) {
      const found = findSet(id);
      if (found) handlers.onRetry(found.set);
    }
  }

  // A second tap on «Terminar» before the first answers does nothing (`busy` renders later).
  const finishing = useRef(false);

  async function finish(end: number | null, typedNote: string) {
    if (finishing.current) return;
    // A set marked but unsaved would be removed as planned (the server never saw it marked).
    if (dirty.current.size > 0 || notCreated.current.size > 0) return;
    finishing.current = true;
    setBusy(true);
    const result = await send(() =>
      finishHealthSession({
        sessionId,
        endedAt: end === null ? null : new Date(end).toISOString(),
        note: typedNote,
      }),
    );
    finishing.current = false;
    setBusy(false);
    if (!result.ok) {
      notSaved(COPY.notSaved.finish, failureReason(result));
      return;
    }
    const finished = result.data;
    const removed = new Set(finished.removedSetIds);
    const savedNote = sessionNoteSchema.safeParse(typedNote);
    const kept = savedNote.success ? savedNote.data : header.note;
    timer.skip();
    writeRest(sessionId, null);
    setFinishSheet((current) => ({ ...current, open: false }));
    // «Terminar» leaves the page: focus goes to the title, which now says the session ended.
    requestFocus(() => document.getElementById(headingId));
    setHeader((current) => ({
      ...current,
      endedAt: finished.endedAt,
      updatedAt: finished.updatedAt,
      note: kept,
    }));
    setNote(kept ?? "");
    setExercises((list) =>
      list.map((row) => ({
        ...row,
        sets: renumber(row.sets.filter((set) => !removed.has(set.id))),
      })),
    );
    setRecords(finished.records);
    const summary = withRecords(
      COPY.summary(
        formatMinutes(minutesBetween(header.startedAt, finished.endedAt)),
        doneAts.length,
      ),
      finished.records.length,
    );
    // Once, right after this «Terminar» (never on opening an old session); reduced motion: none.
    if (finished.records.length > 0) void celebrate();
    toaster.push({
      id: `session-finished-${++noticeSerial.current}`,
      title: COPY.finishedTitle,
      // E4: «Marcaste «Gimnasio».» when this «Terminar» marked the linked habit.
      text: finished.habitMarked
        ? `${COPY.finished(summary)} ${SETTINGS_COPY.habitMarked(finished.habitMarked)}`
        : COPY.finished(summary),
      action: { label: HEALTH_COPY.undo, run: () => void undoFinish(finished) },
    });
  }

  async function undoFinish(finished: FinishResult) {
    const result = await send(() =>
      undoFinishHealthSession({ sessionId, updatedAt: finished.updatedAt }),
    );
    if (!result.ok) {
      notSaved(HEALTH_COPY.notUndone, failureReason(result));
      return;
    }
    adopt(result.data);
    setRecords(NO_RECORDS);
    toaster.push({ title: HEALTH_COPY.undoneTitle, text: COPY.reopened });
  }

  async function remove() {
    if (busy || finishing.current) return;
    if (open && (dirty.current.size > 0 || notCreated.current.size > 0)) return;
    setBusy(true);
    const result = await send(() => deleteHealthSession({ sessionId }));
    if (!result.ok) {
      setBusy(false);
      notSaved(open ? COPY.notSaved.discard : COPY.notSaved.delete, failureReason(result));
      return;
    }
    writeRest(sessionId, null);
    router.push(`${SESSIONS_PATH}?${DELETED_PARAM}=${sessionId}`);
  }

  // ── Times of a finished session ──────────────────────────────────────────────────────────

  const [editingTimes, setEditingTimes] = useState(false);
  const timesKey = useRef<HTMLButtonElement>(null);

  async function saveTimes(startedAt: string, endedAt: string) {
    const result = await send(() => updateSessionTimes({ sessionId, startedAt, endedAt }));
    if (!result.ok) return result;
    setHeader((current) => ({ ...current, ...result.data }));
    // Which sessions count as earlier depends on the start.
    refreshRecords();
    setEditingTimes(false);
    requestFocus(() => timesKey.current);
    announce(COPY.timesSaved);
    return result;
  }

  // ── Render ───────────────────────────────────────────────────────────────────────────────

  const doneCount = doneAts.length;

  return (
    <article
      className="flex flex-col gap-8"
      data-session={sessionId}
      data-session-open={open || undefined}
      data-saving={saving || undefined}
    >
      <header className="flex flex-col gap-3">
        <h1 id={headingId} tabIndex={-1} className="bo-text-display break-words outline-none">
          {name}
        </h1>
        {open ? (
          <p className="bo-text-body flex flex-wrap items-center gap-x-3 gap-y-1 text-text-secondary">
            <span>{COPY.startedAt(formatTimeOfDay(header.startedAt))}</span>
            <Elapsed startedAt={header.startedAt} />
          </p>
        ) : (
          <div className="flex flex-col gap-1" data-session-summary="">
            <p className="bo-text-body text-text-secondary">
              {COPY.span(
                formatSessionDay(header.startedAt),
                formatTimeOfDay(header.startedAt),
                formatTimeOfDay(header.endedAt as string),
              )}
            </p>
            <p className="bo-text-heading">
              {withRecords(
                COPY.summary(
                  formatMinutes(minutesBetween(header.startedAt, header.endedAt as string)),
                  doneCount,
                ),
                records.length,
              )}
            </p>
            <SessionRecords records={records} />
          </div>
        )}
        <div role="group" aria-label={COPY.actionsLabel} className="flex flex-wrap gap-2">
          {exercises.length > 1 ? (
            <Key
              ref={orderKey}
              variant="ghost"
              icon={ordering ? Check : ArrowDownUp}
              aria-pressed={ordering}
              data-session-order=""
              onClick={() => setOrdering((current) => !current)}
            >
              {ordering ? COPY.orderDone : COPY.order}
            </Key>
          ) : null}
          {open ? null : (
            <>
              <Key
                ref={timesKey}
                variant="ghost"
                icon={Clock}
                aria-expanded={editingTimes}
                data-session-times=""
                onClick={() => setEditingTimes((current) => !current)}
              >
                {COPY.editTimes}
              </Key>
              <Key
                variant="ghost"
                icon={Trash2}
                aria-disabled={busy || undefined}
                data-session-delete=""
                onClick={() => void remove()}
              >
                {COPY.deleteSession}
              </Key>
            </>
          )}
        </div>
        {editingTimes && !open ? (
          <TimesForm
            startedAt={header.startedAt}
            endedAt={header.endedAt as string}
            onCancel={() => {
              setEditingTimes(false);
              requestFocus(() => timesKey.current);
            }}
            onSave={saveTimes}
          />
        ) : null}
      </header>

      <section aria-label={COPY.exercisesLabel} className="flex max-w-160 flex-col gap-4">
        {ordering && exercises.length > 1 ? (
          <OrderListContext value={list}>
            <SortableRows {...list} />
          </OrderListContext>
        ) : exercises.length > 0 ? (
          exercises.map((exercise) => (
            <ExerciseBlock key={exercise.id} exercise={exercise} unsaved={unsaved} {...handlers} />
          ))
        ) : (
          <p className="bo-text-body-sm text-text-secondary">{COPY.exercisesEmpty}</p>
        )}
        <Key
          ref={addKey}
          icon={Plus}
          className="self-start"
          aria-disabled={full || undefined}
          data-session-add=""
          onClick={() => {
            if (!full) setPicker((current) => ({ key: current.key + 1, open: true }));
          }}
        >
          {COPY.addExercise}
        </Key>
      </section>

      {/* No heading over the note (E5): the field's own label says «Nota» once. */}
      <section className="flex max-w-160 flex-col gap-4">
        <TextArea
          id={noteId}
          label={COPY.note}
          help={COPY.noteHelp}
          value={note}
          error={noteError}
          rows={3}
          data-session-note=""
          onChange={(event) => {
            setNote(event.target.value);
            setNoteError(undefined);
          }}
          onBlur={saveNote}
        />
        {open ? (
          <Key
            ref={finishKey}
            variant="signal"
            icon={Flag}
            className="self-start"
            data-session-finish=""
            onClick={() =>
              setFinishSheet((current) => ({
                key: current.key + 1,
                open: true,
                openedAt: Date.now(),
              }))
            }
          >
            {COPY.finish}
          </Key>
        ) : null}
      </section>

      <RestBar timer={timer} returnFocus={restReturn} />

      <FinishSheet
        key={`finish-${finishSheet.key}`}
        open={finishSheet.open}
        onOpenChange={(next) => setFinishSheet((current) => ({ ...current, open: next }))}
        returnFocusRef={finishKey}
        startedAt={header.startedAt}
        doneAts={doneAts}
        planned={planned}
        note={note}
        openedAt={finishSheet.openedAt}
        busy={busy}
        unsaved={unsaved.size}
        onRetryAll={retryAll}
        onFinish={(end, typedNote) => void finish(end, typedNote)}
        onDiscard={() => void remove()}
      />
      <ExercisePickerSheet
        key={`picker-${picker.key}`}
        open={picker.open}
        onOpenChange={(next) => setPicker((current) => ({ ...current, open: next }))}
        returnFocusRef={addKey}
        exercises={catalogue}
        onPick={addExercise}
        onCreate={(typed) => {
          pendingCreate.current = typed;
        }}
        onClosed={() => {
          const typed = pendingCreate.current;
          pendingCreate.current = null;
          if (typed !== null) {
            setCreator((current) => ({ key: current.key + 1, open: true, name: typed }));
          }
        }}
      />
      <ExerciseFormSheet
        key={`creator-${creator.key}`}
        open={creator.open}
        onOpenChange={(next) => setCreator((current) => ({ ...current, open: next }))}
        returnFocusRef={addKey}
        initialName={creator.name}
        onCreated={addExercise}
      />
    </article>
  );
}

/** «52 min · 14 series», plus «· 2 récords nuevos» when there are any. */
function withRecords(summary: string, count: number): string {
  return count > 0 ? `${summary} · ${RECORDS_COPY.newCount(count)}` : summary;
}

/** The running time («23:45»); assistive tech reads «En curso: 23 min» (once a minute). */
function Elapsed({ startedAt }: { startedAt: string }) {
  const now = useSecondClock();
  if (now === null) return null;
  const ms = Math.max(0, now - Date.parse(startedAt));
  return (
    <span className="bo-text-label tabular-nums" data-session-elapsed="">
      <span aria-hidden>{formatElapsed(ms)}</span>
      <span className="sr-only">{COPY.elapsedName(Math.floor(ms / 60_000))}</span>
    </span>
  );
}

/** The start and end of a finished session, in Lima. */
function TimesForm({
  startedAt,
  endedAt,
  onCancel,
  onSave,
}: {
  startedAt: string;
  endedAt: string;
  onCancel: () => void;
  /** The instants as ISO strings: a field left as it was sends its stored instant (seconds kept). */
  onSave: (startedAt: string, endedAt: string) => Promise<ActionResult<unknown>>;
}) {
  const ids = useId();
  const [start, setStart] = useState(() => toLimaInput(startedAt));
  const [end, setEnd] = useState(() => toLimaInput(endedAt));
  const [errors, setErrors] = useState<{ start?: string; end?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  async function submit() {
    if (pending) return;
    const from = fromLimaInput(start);
    const to = fromLimaInput(end);
    const now = Date.now();
    const next: typeof errors = {};
    if (!Number.isFinite(from)) next.start = SESSION_ERRORS.time;
    else if (from > now) next.start = SESSION_ERRORS.startInFuture;
    if (!Number.isFinite(to)) next.end = SESSION_ERRORS.time;
    else if (Number.isFinite(from) && to < from) next.end = SESSION_ERRORS.endBeforeStart;
    else if (to > now) next.end = SESSION_ERRORS.endOutOfRange;
    setErrors(next);
    if (next.start || next.end) {
      document.getElementById(next.start ? `${ids}-start` : `${ids}-end`)?.focus();
      return;
    }
    setPending(true);
    // Only what changed: the inputs have minutes, the stored instants have seconds too.
    const result = await onSave(
      start === toLimaInput(startedAt) ? startedAt : new Date(from).toISOString(),
      end === toLimaInput(endedAt) ? endedAt : new Date(to).toISOString(),
    );
    setPending(false);
    if (!result.ok) {
      const fields = result.fieldErrors ?? {};
      setErrors({
        start: fields.startedAt?.[0],
        end: fields.endedAt?.[0],
        form: fields.startedAt || fields.endedAt ? undefined : result.error,
      });
    }
  }

  return (
    <form
      noValidate
      aria-label={COPY.timesForm}
      className="flex max-w-160 flex-col gap-3"
      data-session-times-form=""
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={`${ids}-start`}
          type="datetime-local"
          label={COPY.startLabel}
          value={start}
          error={errors.start}
          autoFocus
          onChange={(event) => {
            setStart(event.target.value);
            setErrors({});
          }}
        />
        <TextField
          id={`${ids}-end`}
          type="datetime-local"
          label={COPY.endLabel}
          value={end}
          error={errors.end}
          onChange={(event) => {
            setEnd(event.target.value);
            setErrors({});
          }}
        />
      </div>
      <p role="status" className="bo-text-body-sm text-signal-text">
        {errors.form ?? ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Key type="submit" variant="signal" aria-disabled={pending || undefined}>
          {HEALTH_COPY.save}
        </Key>
        <Key variant="ghost" onClick={onCancel}>
          {HEALTH_COPY.cancel}
        </Key>
      </div>
    </form>
  );
}
