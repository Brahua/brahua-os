"use client";

import { ClipboardPaste, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Key, SectionLabel, TextArea, TextField } from "@/design-system";
import { hasNotice } from "@/lib/toast/queue";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { applyOrder, moveId } from "@/modules/core/life-area-order";
import { MAX_STEPS_PER_TRACK } from "../learning-constants";
import { LEARNING_COPY as COPY } from "../learning-copy";
import {
  addStep,
  deleteStep,
  markStepDone,
  pasteSteps,
  renameStep,
  reorderSteps,
  undoDeleteStep,
  undoMarkStepDone,
  undoPasteSteps,
} from "../steps-actions";
import { STEP_ERRORS, STEPS_COPY } from "../steps-copy";
import {
  addStepInputSchema,
  pasteStepsInputSchema,
  type StepDoneResult,
  type StepItem,
} from "../steps-input";
import type { StepChange } from "../steps-optimistic";
import { nextStep, parseSyllabus, stepCounts } from "../syllabus";
import { focusSelector, PlainSteps, StepListContext, type StepListProps } from "./step-rows";
import { failureReason, useLearningSave } from "./use-learning-save";

// dnd-kit only loads in the browser, after the page: until then (and on the server) the plain
// list with the same rows and working Subir/Bajar keys stands in.
const SortableSteps = dynamic(() => import("./sortable-steps"), {
  ssr: false,
  loading: () => <PlainSteps />,
});

type StepsSectionProps = {
  trackId: string;
  /** The syllabus as shown (the detail's optimistic view). */
  steps: StepItem[];
  /** Applies a change to that view (a `useOptimistic` setter; called inside the save's transition). */
  applyChange: (change: StepChange) => void;
};

/** How long a focus request waits for its element to render. */
const FOCUS_WAIT_MS = 3_000;

const editButton = (id: string) => document.querySelector<HTMLElement>(focusSelector(id, "edit"));
const checkBox = (id: string) => document.querySelector<HTMLElement>(focusSelector(id, "check"));

/**
 * «Temario» (SPEC-learning "Detalle"): the steps in order with their checkbox (one tap, with
 * «Deshacer»), the next one highlighted; a step added inline (Enter adds another) or a whole list
 * pasted at the end («Pegar temario», with «Deshacer»); renamed and removed in their row;
 * reordered by dragging or with Subir/Bajar. Every change but the paste shows at once and is saved
 * through the screen's queue; a refusal or a network failure rolls it back with a notice.
 */
export function StepsSection({ trackId, steps, applyChange }: StepsSectionProps) {
  const { save, send, toaster, announce, saving } = useLearningSave();
  const reducedMotion = usePrefersReducedMotion();
  const headingId = useId();
  const fieldId = useId();
  const pasteId = useId();
  const counts = stepCounts(steps);
  const next = nextStep(steps);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | undefined>();
  const addInput = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(steps.length === 0);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | undefined>();
  const [pasting, setPasting] = useState(false);
  const pasteKey = useRef<HTMLButtonElement>(null);
  const pasteInput = useRef<HTMLTextAreaElement>(null);

  // Element to focus after a render (an editor closed, or a row went away). One that isn't there
  // yet (the paste's key waits for the server's syllabus) is looked for again on the next
  // renders, for a short while.
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
  const latest = useRef(steps);
  useLayoutEffect(() => {
    latest.current = steps;
  });

  // Consecutive moves share one notice; its «Deshacer» restores the order before the first.
  const reorderBurst = useRef<{ noticeId: string; before: string[]; moves: number } | null>(null);
  const noticeSerial = useRef(0);

  // ── Check ───────────────────────────────────────────────────────────────────────────────

  function toggle(step: StepItem, done: boolean) {
    const optimistic = done ? new Date().toISOString() : null;
    save<StepDoneResult>({
      apply: () => applyChange({ type: "done", id: step.id, doneAt: optimistic }),
      key: `step-done:${step.id}`,
      call: () => markStepDone({ trackId, id: step.id, done }),
      failure: STEPS_COPY.notSaved.check,
      onSuccess: (result) => {
        if (result.step.doneAt === result.previous) return;
        toaster.push({
          title: done ? STEPS_COPY.doneTitle : STEPS_COPY.undoneTitle,
          text: done ? STEPS_COPY.doneNotice(step.title) : STEPS_COPY.undoneNotice(step.title),
          action: { label: COPY.undo, run: () => undoToggle(step, result) },
        });
      },
    });
  }

  function undoToggle(step: StepItem, result: StepDoneResult) {
    save({
      apply: () => applyChange({ type: "done", id: step.id, doneAt: result.previous }),
      key: `step-done:${step.id}`,
      call: () =>
        undoMarkStepDone({
          trackId,
          id: step.id,
          expected: result.step.doneAt,
          restore: result.previous,
        }),
      failure: COPY.notUndone,
      onSuccess: () => {
        toaster.push({ title: COPY.undoneTitle, text: COPY.statusRestored });
        requestFocus(() => checkBox(step.id));
      },
    });
  }

  // ── Add ─────────────────────────────────────────────────────────────────────────────────

  function add() {
    const id = crypto.randomUUID();
    const parsed = addStepInputSchema.safeParse({ trackId, id, title: draft });
    if (!parsed.success) {
      setAddError(parsed.error.issues.find((issue) => issue.path[0] === "title")?.message);
      addInput.current?.focus();
      return;
    }
    if (steps.length >= MAX_STEPS_PER_TRACK) {
      setAddError(STEP_ERRORS.tooMany);
      addInput.current?.focus();
      return;
    }
    const { title } = parsed.data;
    setDraft("");
    setAddError(undefined);
    // Enter adds another: the field stays under the cursor.
    addInput.current?.focus();
    save({
      apply: () =>
        applyChange({ type: "add", step: { id, title, position: steps.length, doneAt: null } }),
      key: null,
      call: () => addStep(parsed.data),
      failure: STEPS_COPY.notSaved.add,
      onSuccess: () => announce(STEPS_COPY.added(title)),
      // The text comes back to the field, unless something new was typed meanwhile.
      onFailure: () => setDraft((current) => (current === "" ? title : current)),
    });
  }

  // ── Paste ───────────────────────────────────────────────────────────────────────────────

  async function paste() {
    if (pasting) return;
    const parsed = pasteStepsInputSchema.safeParse({ trackId, syllabus: pasteText });
    if (!parsed.success) {
      setPasteError(parsed.error.issues[0]?.message);
      pasteInput.current?.focus();
      return;
    }
    if (steps.length + parsed.data.syllabus.length > MAX_STEPS_PER_TRACK) {
      setPasteError(STEP_ERRORS.tooMany);
      pasteInput.current?.focus();
      return;
    }
    setPasting(true);
    const result = await send(() => pasteSteps({ trackId, syllabus: pasteText }));
    setPasting(false);
    if (!result.ok) {
      setPasteError(failureReason(result));
      pasteInput.current?.focus();
      return;
    }
    const added = result.data;
    setPasteText("");
    setPasteError(undefined);
    setPasteOpen(false);
    requestFocus(() => pasteKey.current);
    toaster.push({
      title: STEPS_COPY.pastedTitle,
      text: STEPS_COPY.pasted(added.length),
      action: { label: COPY.undo, run: () => undoPaste(added) },
    });
  }

  function undoPaste(added: StepItem[]) {
    save({
      key: null,
      call: () => undoPasteSteps({ trackId, ids: added.map((step) => step.id) }),
      failure: COPY.notUndone,
      onSuccess: (removed) =>
        toaster.push({ title: COPY.undoneTitle, text: STEPS_COPY.pasteRemoved(removed) }),
    });
  }

  // ── Rename ──────────────────────────────────────────────────────────────────────────────

  function closeEditor(step: StepItem) {
    setEditingId(null);
    // The title button unmounted while editing: focus goes back to it.
    requestFocus(() => editButton(step.id));
  }

  function saveEdit(step: StepItem, title: string) {
    closeEditor(step);
    if (title === step.title) return;
    save({
      apply: () => applyChange({ type: "rename", id: step.id, title }),
      key: `step-edit:${step.id}`,
      call: () => renameStep({ trackId, id: step.id, title }),
      failure: STEPS_COPY.notSaved.update,
      onSuccess: () => announce(STEPS_COPY.saved),
    });
  }

  // ── Remove and undo ─────────────────────────────────────────────────────────────────────

  function remove(step: StepItem) {
    const position = steps.findIndex((item) => item.id === step.id);
    if (position === -1) return;
    const neighbour = steps[position + 1] ?? steps[position - 1];
    const afterId = steps[position - 1]?.id ?? null;
    setEditingId(null);
    // The row is going away: focus moves to the next one (or the previous), else to «Nuevo paso».
    requestFocus(() => (neighbour ? editButton(neighbour.id) : addInput.current));
    const noticeId = toaster.push({
      id: `step-delete-${step.id}-${++noticeSerial.current}`,
      title: STEPS_COPY.removedTitle,
      text: STEPS_COPY.removed(step.title),
      action: { label: COPY.undo, run: () => undoRemove(step, position, afterId) },
    });
    save({
      apply: () => applyChange({ type: "remove", id: step.id }),
      key: null,
      call: () => deleteStep({ trackId, id: step.id }),
      failure: STEPS_COPY.notSaved.remove,
      onFailure: () => toaster.dismiss(noticeId),
    });
  }

  function undoRemove(step: StepItem, position: number, afterId: string | null) {
    save({
      apply: () => applyChange({ type: "restore", step, position, afterId }),
      key: null,
      call: () => undoDeleteStep({ trackId, id: step.id, position, afterId }),
      failure: COPY.notUndone,
      onSuccess: () =>
        toaster.push({ title: COPY.undoneTitle, text: STEPS_COPY.restored(step.title) }),
    });
  }

  // ── Reorder ─────────────────────────────────────────────────────────────────────────────

  function move(id: string, to: number) {
    const ids = steps.map((step) => step.id);
    const from = ids.indexOf(id);
    if (from === -1 || from === to) return;
    const order = moveId(ids, from, to);
    const step = steps[from];

    const current = reorderBurst.current;
    const burst =
      current && hasNotice(toaster.state, current.noticeId)
        ? current
        : { noticeId: `step-order-${++noticeSerial.current}`, before: ids, moves: 0 };
    reorderBurst.current = burst;
    const turn = ++burst.moves;
    toaster.replace({
      id: burst.noticeId,
      title: STEPS_COPY.orderTitle,
      text: STEPS_COPY.moved(step.title, STEPS_COPY.position(to, order.length)),
      action: { label: COPY.undo, run: () => restoreOrder(burst.before) },
    });
    save({
      apply: () => applyChange({ type: "reorder", ids: order }),
      // Every step is sent: each one matters for the burst's «Deshacer».
      key: null,
      call: () => reorderSteps({ trackId, ids: order }),
      failure: STEPS_COPY.notSaved.reorder,
      onFailure: () => {
        // A later move is on its way (or saved) and decides: no notice for this one either.
        if (turn !== burst.moves) return false;
        toaster.dismiss(burst.noticeId);
        if (reorderBurst.current === burst) reorderBurst.current = null;
      },
    });
  }

  function restoreOrder(before: string[]) {
    reorderBurst.current = null;
    // The order from before the moves, over today's steps: one added since goes last, one removed
    // since is left out, so the list sent is still exactly the track's set.
    const ids = applyOrder(latest.current, before).map((step) => step.id);
    save({
      apply: () => applyChange({ type: "reorder", ids }),
      key: null,
      call: () => reorderSteps({ trackId, ids }),
      failure: COPY.notUndone,
      onSuccess: () => toaster.push({ title: COPY.undoneTitle, text: STEPS_COPY.orderRestored }),
    });
  }

  const listProps: StepListProps = {
    steps,
    nextId: next?.id ?? null,
    reducedMotion,
    editingId,
    onMove: move,
    onToggle: toggle,
    onEdit: (step) => setEditingId(step.id),
    onCancelEdit: closeEditor,
    onSave: saveEdit,
    onDelete: remove,
  };

  const preview = pasteText.trim() === "" ? null : parseSyllabus(pasteText);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
      data-steps=""
      data-saving={saving || pasting || undefined}
    >
      <SectionLabel
        id={headingId}
        as="h2"
        title={STEPS_COPY.section}
        count={steps.length > 0 ? `${counts.done}/${counts.total}` : undefined}
        aria-label={
          steps.length > 0 ? STEPS_COPY.sectionName(counts.done, counts.total) : undefined
        }
      />
      {steps.length > 0 ? (
        <StepListContext value={listProps}>
          <SortableSteps {...listProps} />
        </StepListContext>
      ) : (
        <p className="bo-text-body-sm max-w-160 text-text-secondary">{STEPS_COPY.empty}</p>
      )}

      {pasteOpen ? (
        <form
          noValidate
          aria-label={STEPS_COPY.paste}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void paste();
          }}
        >
          <TextArea
            ref={pasteInput}
            id={pasteId}
            label={STEPS_COPY.pasteLabel}
            rows={6}
            value={pasteText}
            error={pasteError}
            help={
              preview?.ok
                ? `${STEPS_COPY.pasteCount(preview.titles.length)} ${STEPS_COPY.pasteHelp}`
                : STEPS_COPY.pasteHelp
            }
            data-steps-paste=""
            onChange={(event) => {
              setPasteText(event.target.value);
              setPasteError(undefined);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Key type="submit" variant="signal" aria-disabled={pasting || undefined}>
              {STEPS_COPY.pasteSubmit}
            </Key>
            {steps.length > 0 ? (
              <Key
                variant="ghost"
                onClick={() => {
                  setPasteOpen(false);
                  setPasteError(undefined);
                  requestFocus(() => pasteKey.current);
                }}
              >
                {STEPS_COPY.pasteCancel}
              </Key>
            ) : null}
          </div>
        </form>
      ) : null}

      {steps.length > 0 ? (
        <form
          noValidate
          aria-label={STEPS_COPY.add}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <TextField
            ref={addInput}
            id={fieldId}
            label={STEPS_COPY.addLabel}
            value={draft}
            autoComplete="off"
            enterKeyHint="enter"
            error={addError}
            help={STEPS_COPY.addHelp}
            onChange={(event) => {
              setDraft(event.target.value);
              setAddError(undefined);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Key type="submit" icon={Plus}>
              {STEPS_COPY.add}
            </Key>
            {pasteOpen ? null : (
              <Key
                ref={pasteKey}
                variant="ghost"
                icon={ClipboardPaste}
                data-steps-paste-open=""
                onClick={() => {
                  setPasteOpen(true);
                  requestFocus(() => pasteInput.current);
                }}
              >
                {STEPS_COPY.paste}
              </Key>
            )}
          </div>
        </form>
      ) : null}
    </section>
  );
}
