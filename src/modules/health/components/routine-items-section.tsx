"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon, Key, SectionLabel, TextField } from "@/design-system";
import { hasNotice } from "@/lib/toast/queue";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { applyOrder, moveId } from "@/modules/core/life-area-order";
import { EXERCISES_COPY } from "../exercises-copy";
import type { ExerciseItem } from "../exercises-input";
import { formatDuration, formatTargets, restChoices } from "../format";
import { DEFAULT_TARGETS, MAX_ROUTINE_ITEMS, usesReps } from "../health-constants";
import { HEALTH_COPY } from "../health-copy";
import type { ItemChange } from "../routine-items-optimistic";
import {
  addRoutineItem,
  removeRoutineItem,
  reorderRoutineItems,
  restoreRoutineItem,
  updateRoutineItem,
} from "../routines-actions";
import { ROUTINE_ERRORS, ROUTINES_COPY as COPY } from "../routines-copy";
import {
  formToTargets,
  targetsToForm,
  type RoutineItem,
  type TargetField,
  type TargetsForm,
} from "../routines-input";
import { Select } from "./exercise-fields";
import { ExerciseFormSheet } from "./exercise-form-sheet";
import { ExercisePickerSheet } from "./exercise-picker-sheet";
import {
  OrderListContext,
  orderFocusSelector,
  PlainOrderRows,
  type OrderItem,
  type OrderListProps,
} from "./order-rows";
import { useHealthSave } from "./use-health-save";

// dnd-kit only loads in the browser, after the page: until then (and on the server) the plain
// list with the same rows and working Subir/Bajar keys stands in.
const SortableRows = dynamic(() => import("./sortable-rows"), {
  ssr: false,
  loading: () => <PlainOrderRows />,
});

type RoutineItemsSectionProps = {
  routineId: string;
  /** The routine's exercises as shown (the detail's optimistic view). */
  items: RoutineItem[];
  /** Applies a change to that view (a `useOptimistic` setter; called inside the save's transition). */
  applyChange: (change: ItemChange) => void;
  /** The live catalogue (the picker). */
  exercises: ExerciseItem[];
};

/** What the item editor sends. */
type Targets = Pick<RoutineItem, TargetField>;

/** A row in the list needs a `name` (the reorder's announcements and keys). */
type Row = RoutineItem & { name: string };

/** How long a focus request waits for its element to render. */
const FOCUS_WAIT_MS = 3_000;

const editKey = (id: string) => document.querySelector<HTMLElement>(orderFocusSelector(id, "main"));

/** The rest a row says: its own, or the exercise's. */
function restLine(item: RoutineItem): string {
  return item.restSeconds === null
    ? COPY.restFromExercise(formatDuration(item.exerciseRestSeconds))
    : COPY.restLine(formatDuration(item.restSeconds));
}

/**
 * «Ejercicios» of a routine (SPEC-health "Pantallas"): its exercises in order, each with its
 * targets («4 × 8–10») and rest, edited in their row; added from the catalogue («Agregar
 * ejercicio», with «Nuevo ejercicio» when it isn't there), removed with «Deshacer», reordered by
 * dragging or with Subir/Bajar. Every change shows at once and is saved through the screen's queue;
 * a refusal or a network failure rolls it back with a notice.
 */
export function RoutineItemsSection({
  routineId,
  items,
  applyChange,
  exercises,
}: RoutineItemsSectionProps) {
  const { save, toaster, announce, saving } = useHealthSave();
  const reducedMotion = usePrefersReducedMotion();
  const headingId = useId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const addKey = useRef<HTMLButtonElement>(null);
  const [picker, setPicker] = useState({ key: 0, open: false });
  const [creator, setCreator] = useState({ key: 0, open: false, name: "" });
  // «Nuevo ejercicio» from the picker: the form opens once the picker has closed.
  const pendingCreate = useRef<string | null>(null);
  const full = items.length >= MAX_ROUTINE_ITEMS;

  // Element to focus after a render (an editor closed, or a row went away).
  const focusRequest = useRef<{ find: () => HTMLElement | null; at: number } | null>(null);
  function requestFocus(find: () => HTMLElement | null) {
    focusRequest.current = { find, at: performance.now() };
  }
  useEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    const element = request.find();
    if (element) {
      focusRequest.current = null;
      element.focus();
    } else if (performance.now() - request.at > FOCUS_WAIT_MS) {
      focusRequest.current = null;
    }
  });

  // The list as last rendered, for undo actions that run from an older notice.
  const latest = useRef(items);
  useLayoutEffect(() => {
    latest.current = items;
  });

  // Consecutive moves share one notice; its «Deshacer» restores the order before the first.
  const reorderBurst = useRef<{ noticeId: string; before: string[]; moves: number } | null>(null);
  const noticeSerial = useRef(0);

  // ── Add ─────────────────────────────────────────────────────────────────────────────────

  function add(exercise: ExerciseItem) {
    if (latest.current.length >= MAX_ROUTINE_ITEMS) {
      toaster.push({
        title: HEALTH_COPY.notSavedTitle,
        text: `${COPY.notSaved.add} ${ROUTINE_ERRORS.tooMany}`,
        tone: "error",
      });
      return;
    }
    const id = crypto.randomUUID();
    const targets = { ...DEFAULT_TARGETS[exercise.kind], restSeconds: null };
    const item: RoutineItem = {
      id,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      kind: exercise.kind,
      equipment: exercise.equipment,
      perDumbbell: exercise.perDumbbell,
      exerciseRestSeconds: exercise.restSeconds,
      position: latest.current.length,
      ...targets,
    };
    save({
      apply: () => applyChange({ type: "add", item }),
      key: null,
      call: () => addRoutineItem({ routineId, id, exerciseId: exercise.id, ...targets }),
      failure: COPY.notSaved.add,
      onSuccess: () => announce(COPY.added(exercise.name)),
    });
  }

  // ── Edit ────────────────────────────────────────────────────────────────────────────────

  function closeEditor(item: RoutineItem) {
    setEditingId(null);
    // The row's edit key unmounted while editing: focus goes back to it.
    requestFocus(() => editKey(item.id));
  }

  function saveTargets(item: RoutineItem, targets: Targets) {
    closeEditor(item);
    save({
      apply: () => applyChange({ type: "update", id: item.id, targets }),
      key: `item-edit:${item.id}`,
      call: () => updateRoutineItem({ routineId, id: item.id, ...targets }),
      failure: COPY.notSaved.update,
      onSuccess: () => announce(COPY.itemSaved),
    });
  }

  // ── Remove and undo ─────────────────────────────────────────────────────────────────────

  function remove(item: RoutineItem) {
    const position = items.findIndex((row) => row.id === item.id);
    if (position === -1) return;
    const neighbour = items[position + 1] ?? items[position - 1];
    const afterId = items[position - 1]?.id ?? null;
    setEditingId(null);
    // The row is going away: focus moves to the next one (or the previous), else to «Agregar».
    requestFocus(() => (neighbour ? editKey(neighbour.id) : addKey.current));
    const noticeId = toaster.push({
      id: `item-delete-${item.id}-${++noticeSerial.current}`,
      title: COPY.removedTitle,
      text: COPY.removed(item.exerciseName),
      action: { label: HEALTH_COPY.undo, run: () => undoRemove(item, position, afterId) },
    });
    save({
      apply: () => applyChange({ type: "remove", id: item.id }),
      key: null,
      call: () => removeRoutineItem({ routineId, id: item.id }),
      failure: COPY.notSaved.remove,
      onFailure: () => toaster.dismiss(noticeId),
    });
  }

  function undoRemove(item: RoutineItem, position: number, afterId: string | null) {
    save({
      apply: () => applyChange({ type: "restore", item, position, afterId }),
      key: null,
      call: () => restoreRoutineItem({ routineId, id: item.id, position, afterId }),
      failure: HEALTH_COPY.notUndone,
      onSuccess: () =>
        toaster.push({
          title: HEALTH_COPY.undoneTitle,
          text: COPY.itemRestored(item.exerciseName),
        }),
    });
  }

  // ── Reorder ─────────────────────────────────────────────────────────────────────────────

  function move(id: string, to: number) {
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(id);
    if (from === -1 || from === to) return;
    const order = moveId(ids, from, to);
    const item = items[from];

    const current = reorderBurst.current;
    const burst =
      current && hasNotice(toaster.state, current.noticeId)
        ? current
        : { noticeId: `item-order-${++noticeSerial.current}`, before: ids, moves: 0 };
    reorderBurst.current = burst;
    const turn = ++burst.moves;
    toaster.replace({
      id: burst.noticeId,
      title: COPY.itemsOrderTitle,
      text: COPY.moved(item.exerciseName, COPY.position(to, order.length)),
      action: { label: HEALTH_COPY.undo, run: () => restoreOrder(burst.before) },
    });
    save({
      apply: () => applyChange({ type: "reorder", ids: order }),
      key: null,
      call: () => reorderRoutineItems({ routineId, ids: order }),
      failure: COPY.notSaved.reorder,
      onFailure: () => {
        if (turn !== burst.moves) return false;
        toaster.dismiss(burst.noticeId);
        if (reorderBurst.current === burst) reorderBurst.current = null;
      },
    });
  }

  function restoreOrder(before: string[]) {
    reorderBurst.current = null;
    const ids = applyOrder(latest.current, before).map((item) => item.id);
    save({
      apply: () => applyChange({ type: "reorder", ids }),
      key: null,
      call: () => reorderRoutineItems({ routineId, ids }),
      failure: HEALTH_COPY.notUndone,
      onSuccess: () =>
        toaster.push({ title: HEALTH_COPY.undoneTitle, text: COPY.itemsOrderRestored }),
    });
  }

  const rows: Row[] = items.map((item) => ({ ...item, name: item.exerciseName }));
  const listProps: OrderListProps<Row> = {
    items: rows,
    label: COPY.itemsLabel,
    dragRole: COPY.itemDragRole,
    reducedMotion,
    locked: editingId !== null,
    onMove: move,
    renderContent: (item) => (
      <button
        type="button"
        aria-label={COPY.editItem(item.exerciseName)}
        aria-describedby={`${headingId}-${item.id}-targets`}
        data-order-focus={`main:${item.id}`}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        onClick={() => setEditingId(item.id)}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="bo-text-body font-medium break-words">{item.exerciseName}</span>
          <span
            id={`${headingId}-${item.id}-targets`}
            className="bo-text-body-sm text-text-secondary"
          >
            {formatTargets(item.kind, item)} · {restLine(item)}
            {item.perDumbbell ? ` · ${EXERCISES_COPY.perDumbbell}` : ""}
          </span>
        </span>
        {/* That the row edits, at a glance (no room for it under 360 px; the name says it). */}
        <Icon icon={Pencil} size="sm" className="shrink-0 text-text-secondary max-[359px]:hidden" />
      </button>
    ),
    renderEditor: (item) =>
      editingId === item.id ? (
        <ItemEditor
          item={item}
          onCancel={() => closeEditor(item)}
          onSave={(targets) => saveTargets(item, targets)}
          onRemove={() => remove(item)}
        />
      ) : null,
  };
  // next/dynamic and the context can't carry the row's type (the renders only get these rows).
  const list = listProps as unknown as OrderListProps<OrderItem>;

  return (
    <section
      aria-labelledby={headingId}
      className="flex max-w-160 flex-col gap-3"
      data-routine-items=""
      data-saving={saving || undefined}
    >
      <SectionLabel
        id={headingId}
        as="h2"
        title={COPY.items}
        count={`${items.length}/${MAX_ROUTINE_ITEMS}`}
        aria-label={COPY.itemsName(items.length)}
      />
      {items.length > 0 ? (
        <OrderListContext value={list}>
          <SortableRows {...list} />
        </OrderListContext>
      ) : (
        <p className="bo-text-body-sm text-text-secondary">{COPY.itemsEmpty}</p>
      )}
      {full ? <p className="bo-text-body-sm text-text-secondary">{COPY.itemsFull}</p> : null}
      <Key
        ref={addKey}
        icon={Plus}
        className="self-start"
        aria-disabled={full || undefined}
        data-routine-add=""
        onClick={() => {
          if (full) return;
          setPicker((current) => ({ key: current.key + 1, open: true }));
        }}
      >
        {COPY.addItem}
      </Key>

      <ExercisePickerSheet
        key={`picker-${picker.key}`}
        open={picker.open}
        onOpenChange={(open) => setPicker((current) => ({ ...current, open }))}
        returnFocusRef={addKey}
        exercises={exercises}
        onPick={add}
        onCreate={(name) => {
          pendingCreate.current = name;
        }}
        onClosed={() => {
          const name = pendingCreate.current;
          pendingCreate.current = null;
          if (name !== null) setCreator((current) => ({ key: current.key + 1, open: true, name }));
        }}
      />
      <ExerciseFormSheet
        key={`creator-${creator.key}`}
        open={creator.open}
        onOpenChange={(open) => setCreator((current) => ({ ...current, open }))}
        returnFocusRef={addKey}
        initialName={creator.name}
        onCreated={add}
      />
    </section>
  );
}

const FIELD_ORDER: readonly TargetField[] = [
  "targetSets",
  "repsMin",
  "repsMax",
  "targetSeconds",
  "restSeconds",
];

/** An item's targets, edited in its row, plus «Quitar de la rutina». Enter saves, Esc cancels. */
function ItemEditor({
  item,
  onCancel,
  onSave,
  onRemove,
}: {
  item: RoutineItem;
  onCancel: () => void;
  onSave: (targets: Targets) => void;
  onRemove: () => void;
}) {
  const ids = useId();
  const [form, setForm] = useState<TargetsForm>(() => targetsToForm(item.kind, item));
  const [errors, setErrors] = useState<Partial<Record<TargetField, string>>>({});
  const reps = usesReps(item.kind);
  const idOf = (field: TargetField) => `${ids}-${field}`;
  const nameId = `${ids}-name`;
  /** The exercise's name, then the field's own error or help (what TextField would describe). */
  const describedBy = (field: TargetField, help?: string) =>
    [nameId, errors[field] ? `${idOf(field)}-error` : help ? `${idOf(field)}-help` : null]
      .filter(Boolean)
      .join(" ");

  function set(field: keyof TargetsForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    const target: TargetField = field === "duration" ? "targetSeconds" : field;
    setErrors((current) => (current[target] ? { ...current, [target]: undefined } : current));
  }

  function submit() {
    const result = formToTargets(item.kind, form);
    if (!result.ok) {
      setErrors(result.errors);
      const first = FIELD_ORDER.find((field) => result.errors[field]);
      if (first) document.getElementById(idOf(first))?.focus();
      return;
    }
    onSave(result.targets);
  }

  const firstError = FIELD_ORDER.map((field) => errors[field]).find(Boolean);

  return (
    <form
      noValidate
      aria-label={COPY.itemForm(item.exerciseName)}
      className="flex min-w-0 flex-1 flex-col gap-4"
      data-item-editor={item.id}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // The notice viewport also listens for Esc on the document: this one is the editor's.
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <p id={nameId} className="bo-text-body font-medium break-words">
        {item.exerciseName}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <TextField
          id={idOf("targetSets")}
          label={COPY.setsLabel}
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={form.targetSets}
          error={errors.targetSets}
          aria-describedby={describedBy("targetSets")}
          onChange={(event) => set("targetSets", event.target.value)}
        />
        {reps ? (
          <>
            <TextField
              id={idOf("repsMin")}
              label={COPY.repsMinLabel}
              inputMode="numeric"
              autoComplete="off"
              value={form.repsMin}
              error={errors.repsMin}
              aria-describedby={describedBy("repsMin")}
              onChange={(event) => set("repsMin", event.target.value)}
            />
            <TextField
              id={idOf("repsMax")}
              label={COPY.repsMaxLabel}
              inputMode="numeric"
              autoComplete="off"
              help={COPY.repsHelp}
              value={form.repsMax}
              error={errors.repsMax}
              aria-describedby={describedBy("repsMax", COPY.repsHelp)}
              onChange={(event) => set("repsMax", event.target.value)}
            />
          </>
        ) : (
          <TextField
            id={idOf("targetSeconds")}
            label={item.kind === "cardio" ? COPY.minutesLabel : COPY.secondsLabel}
            inputMode="numeric"
            autoComplete="off"
            value={form.duration}
            error={errors.targetSeconds}
            aria-describedby={describedBy("targetSeconds")}
            onChange={(event) => set("duration", event.target.value)}
          />
        )}
      </div>
      <Select
        id={idOf("restSeconds")}
        label={COPY.restLabel}
        value={form.restSeconds}
        error={errors.restSeconds}
        describedBy={nameId}
        options={[
          { value: "", label: COPY.restDefault(formatDuration(item.exerciseRestSeconds)) },
          ...restChoices(item.restSeconds).map((seconds) => ({
            value: String(seconds),
            label: formatDuration(seconds),
          })),
        ]}
        onChange={(value) => set("restSeconds", value)}
      />
      <p role="status" className="sr-only">
        {firstError ?? ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Key type="submit" variant="signal">
          {HEALTH_COPY.save}
        </Key>
        <Key variant="ghost" onClick={onCancel}>
          {HEALTH_COPY.cancel}
        </Key>
      </div>
      <Key
        variant="ghost"
        icon={Trash2}
        className="self-start"
        data-item-remove={item.id}
        onClick={onRemove}
      >
        {COPY.removeItem}
      </Key>
    </form>
  );
}
