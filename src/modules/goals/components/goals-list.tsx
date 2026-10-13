"use client";

import { ArchiveRestore, ChevronDown, Plus, ArrowUpDown, Target } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Icon, Key } from "@/design-system";
import { cn } from "@/lib/cn";
import { fail, type ActionResult } from "@/lib/action-result";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { moveId } from "@/modules/core/life-area-order";
import { reorderGoals, unarchiveGoal } from "../actions";
import type { GoalItem } from "../goal-input";
import { applyGoalListChange } from "../goal-list-optimistic";
import { groupGoals } from "../goal-sections";
import { GOALS_COPY } from "../goals-copy";
import { currentPeriod, periodLabel, periodPhase, periodOf } from "../pace";
import { GoalRow } from "./goal-row";
import { failureReason, useGoalsScreen } from "./goals-screen";
import { useGoalEntries } from "./use-goal-entries";

// The sheets' code loads on demand: as soon as a key that opens one is pointed at, focused or
// touched, so it is usually there by the time it opens.
const loadForm = () => import("./goal-form-sheet");
const GoalFormSheet = dynamic(() => loadForm().then((loaded) => loaded.GoalFormSheet));
const preloadForm = () => void loadForm();
// dnd-kit only loads in the browser, once "Ordenar" is pressed.
const SortableGoals = dynamic(() => import("./sortable-goals"), {
  ssr: false,
  loading: () => (
    <p className="bo-text-body-sm text-text-secondary" role="status">
      …
    </p>
  ),
});

/** How long focus may still go to a row that has not appeared yet (a created goal). */
const PENDING_FOCUS_MS = 5_000;

type GoalsListProps = {
  /** Every visible goal (archived ones too), in their manual order. */
  goals: GoalItem[];
  /** Id of the page's heading (tabIndex -1): focus goes there when nothing else is left. */
  headingId: string;
};

/**
 * /goals (SPEC-goals "Pantallas"): "Este trimestre (T4 2026)", "Este año (2026)" and the folded
 * "Anteriores" (periods that ended and archived goals, each with its status and final value, no
 * alarm). A manual goal in course has "+1" and "Sumar…" (optimistic, with "Deshacer" for that
 * exact entry); "Nueva meta" opens the form; "Ordenar" arranges each section by dragging.
 * Everything goes through the screen's save queue, and a refusal rolls back with a notice.
 *
 * G3 slot: "Esta semana" (the weekly objective) goes above the sections.
 */
export function GoalsList({ goals, headingId }: GoalsListProps) {
  const { today, areas, enqueue, toaster, announce } = useGoalsScreen();
  const { push } = toaster;
  const [view, apply] = useOptimistic(goals, applyGoalListChange);
  const [saving, startSaving] = useTransition();
  const reducedMotion = usePrefersReducedMotion();
  const sections = groupGoals(view, today);
  const [previousOpen, setPreviousOpen] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const orderable = sections.quarter.length > 1 || sections.year.length > 1;
  // Ordering needs a section with two goals. Without one the mode ends (adjusted during render)
  // and focus, which was on the "Ordenar" key that just left, goes to the heading.
  if (ordering && !orderable) setOrdering(false);
  const isOrdering = ordering && orderable;
  const wasOrdering = useRef(false);
  useEffect(() => {
    if (isOrdering) {
      wasOrdering.current = true;
      return;
    }
    if (!wasOrdering.current) return;
    wasOrdering.current = false;
    const lost = document.activeElement === document.body || document.activeElement === null;
    if (!orderable && lost) document.getElementById(headingId)?.focus();
  }, [isOrdering, orderable, headingId]);

  // The list as last rendered, for actions that run from an older notice.
  const latest = useRef(view);
  useLayoutEffect(() => {
    latest.current = view;
  });

  // Focus that has to wait for a commit (a created goal's row, before its revalidation).
  const pendingFocus = useRef<{ id: string; until: number } | null>(null);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (Date.now() > pending.until) {
      pendingFocus.current = null;
      return;
    }
    const link = document.querySelector<HTMLElement>(
      `[data-goal-row="${CSS.escape(pending.id)}"] a`,
    );
    if (!link) return;
    pendingFocus.current = null;
    link.focus();
  });

  function notSaved(text: string, reason: string) {
    push({ title: GOALS_COPY.notSavedTitle, text: `${text} ${reason}`, tone: "error" });
  }

  const entries = useGoalEntries({
    view,
    apply,
    startSaving,
    notSaved,
    focusFallback: () => document.getElementById(headingId)?.focus(),
  });

  // ── "Nueva meta" ──
  const [formOpening, setFormOpening] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const formReturn = useRef<HTMLElement | null>(null);

  function openForm(opener: HTMLElement | null) {
    formReturn.current = opener;
    setFormOpening((count) => count + 1);
    setFormOpen(true);
  }

  function onSaved(goal: GoalItem) {
    setFormOpen(false);
    announce(GOALS_COPY.created(goal.title));
    pendingFocus.current = { id: goal.id, until: Date.now() + PENDING_FOCUS_MS };
  }

  // ── Reactivate (a row of "Anteriores") ──
  const reactivating = useRef(new Set<string>());

  function reactivate(goal: GoalItem) {
    // One at a time per goal: a second activation while it is on its way does nothing.
    if (reactivating.current.has(goal.id)) return;
    reactivating.current.add(goal.id);
    const status = goal.achievedAt ? "achieved" : "active";
    startSaving(async () => {
      apply({ type: "update", id: goal.id, patch: { status } });
      const queued = await enqueue(`goal-archive:${goal.id}`, () =>
        unarchiveGoal({ id: goal.id, position: "end" }),
      );
      reactivating.current.delete(goal.id);
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(GOALS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(GOALS_COPY.notReactivated, failureReason(result));
        return;
      }
      announce(GOALS_COPY.reactivated(goal.title));
    });
  }

  // ── Order ──

  /**
   * Moves a goal to position `to` of its section. The order saved is the whole list's: every
   * non-archived goal, each section's goals in their own slots (the other sections untouched).
   */
  function move(section: "quarter" | "year", id: string, to: number) {
    const current = latest.current;
    const inSection = groupGoals(current, today)[section].map((goal) => goal.id);
    const from = inSection.indexOf(id);
    if (from === -1 || from === to) return;
    const moved = moveId(inSection, from, to);
    const sectionIds = new Set(inSection);
    let next = 0;
    const before = current.filter((goal) => goal.status !== "archived").map((goal) => goal.id);
    const ids = before.map((goalId) => (sectionIds.has(goalId) ? moved[next++] : goalId));
    const title = current.find((goal) => goal.id === id)?.title ?? "";
    saveOrder(ids, before, title, GOALS_COPY.position(to, inSection.length));
  }

  /** `undoIds`: the order to go back to (null: this is the undo itself, only announced). */
  function saveOrder(ids: string[], undoIds: string[] | null, title: string, place: string) {
    startSaving(async () => {
      apply({ type: "reorder", ids });
      // No key: every step is sent, in order (each one has its own "Deshacer").
      const queued = await enqueue(null, () => reorderGoals({ ids }));
      if (queued.kind === "skipped") return;
      const result: ActionResult<null> =
        queued.kind === "done" ? queued.value : fail(GOALS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(GOALS_COPY.orderFailed, failureReason(result));
        return;
      }
      if (undoIds === null) {
        announce(GOALS_COPY.orderRestored);
        return;
      }
      push({
        title: GOALS_COPY.orderNoticeTitle,
        text: GOALS_COPY.moved(title, place),
        action: { label: GOALS_COPY.undo, run: () => saveOrder(undoIds, null, title, place) },
      });
    });
  }

  const quarterHeading = GOALS_COPY.quarterHeading(periodLabel(currentPeriod("quarter", today)));
  const yearHeading = GOALS_COPY.yearHeading(periodLabel(currentPeriod("year", today)));
  const canAdd = (goal: GoalItem) =>
    goal.sourceKind === "manual" &&
    goal.status !== "archived" &&
    periodPhase(periodOf(goal), today) === "current";

  function rows(list: GoalItem[], label: string) {
    return (
      <ul aria-label={label} className="bo-list max-w-160">
        {list.map((goal) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            today={today}
            canAdd={canAdd(goal)}
            onAdd={entries.add}
            onAddMore={entries.openAdd}
          />
        ))}
      </ul>
    );
  }

  function section(key: "quarter" | "year", heading: string, label: string, empty: string) {
    const list = sections[key];
    return (
      <section
        aria-labelledby={`${headingId}-${key}`}
        className="flex flex-col gap-3"
        data-goals-section={key}
      >
        <h2 id={`${headingId}-${key}`} className="bo-text-title">
          {heading}
        </h2>
        {list.length === 0 ? (
          <p className="bo-text-body-sm text-text-secondary">{empty}</p>
        ) : (
          rows(list, label)
        )}
      </section>
    );
  }

  const previous = sections.previous;

  return (
    <div className="flex flex-col gap-6" data-saving={saving ? "" : undefined}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          {/* tabIndex -1: focus lands here when nothing else is left. */}
          <h1 id={headingId} tabIndex={-1} className="bo-text-display outline-none">
            {GOALS_COPY.title}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {orderable ? (
            <Key icon={ArrowUpDown} toggle pressed={isOrdering} onPressedChange={setOrdering}>
              {GOALS_COPY.order}
            </Key>
          ) : null}
          <Key
            variant="signal"
            icon={Plus}
            aria-haspopup="dialog"
            onPointerEnter={preloadForm}
            onFocus={preloadForm}
            onTouchStart={preloadForm}
            onClick={(event) => openForm(event.currentTarget)}
          >
            {GOALS_COPY.newGoal}
          </Key>
        </div>
      </header>

      {isOrdering ? (
        <section aria-labelledby={`${headingId}-order`} className="flex flex-col gap-4">
          <h2 id={`${headingId}-order`} className="bo-text-title">
            {GOALS_COPY.orderTitle}
          </h2>
          <p className="bo-text-body-sm max-w-160 text-text-secondary">{GOALS_COPY.orderHelp}</p>
          {(
            [
              ["quarter", quarterHeading],
              ["year", yearHeading],
            ] as const
          ).map(([key, heading]) =>
            sections[key].length > 1 ? (
              <div key={key} className="flex flex-col gap-2">
                <h3 className="bo-text-label text-text-secondary">{heading}</h3>
                <SortableGoals
                  heading={heading}
                  goals={sections[key]}
                  reducedMotion={reducedMotion}
                  onMove={(id, to) => move(key, id, to)}
                />
              </div>
            ) : null,
          )}
        </section>
      ) : view.length === 0 ? (
        <div className="bo-card max-w-160 items-start">
          <Icon icon={Target} size="xl" className="text-text-secondary" />
          <h2 className="bo-text-title">{GOALS_COPY.emptyTitle}</h2>
          <p className="bo-text-body-sm text-text-secondary">{GOALS_COPY.emptyText}</p>
          <Key
            icon={Plus}
            aria-haspopup="dialog"
            onPointerEnter={preloadForm}
            onFocus={preloadForm}
            onTouchStart={preloadForm}
            onClick={(event) => openForm(event.currentTarget)}
          >
            {GOALS_COPY.emptyCreate}
          </Key>
        </div>
      ) : (
        <>
          {section(
            "quarter",
            quarterHeading,
            GOALS_COPY.quarterList,
            GOALS_COPY.emptySectionQuarter,
          )}
          {section("year", yearHeading, GOALS_COPY.yearList, GOALS_COPY.emptySectionYear)}
          {previous.length > 0 ? (
            <PreviousGoals
              goals={previous}
              today={today}
              expanded={previousOpen}
              onExpandedChange={setPreviousOpen}
              onReactivate={reactivate}
            />
          ) : null}
        </>
      )}

      {formOpening > 0 ? (
        <GoalFormSheet
          key={`form-${formOpening}`}
          open={formOpen}
          onOpenChange={setFormOpen}
          areas={areas}
          today={today}
          returnFocusRef={formReturn}
          onCreated={onSaved}
          onClosed={() => {
            const active = document.activeElement;
            if (active === document.body || active === null) {
              document.getElementById(headingId)?.focus();
            }
          }}
        />
      ) : null}
      {entries.addSheet}
    </div>
  );
}

type PreviousGoalsProps = {
  goals: GoalItem[];
  today: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onReactivate: (goal: GoalItem) => void;
};

/** "Anteriores (N)", folded: the periods that ended and the archived goals, each as it was left. */
function PreviousGoals({
  goals,
  today,
  expanded,
  onExpandedChange,
  onReactivate,
}: PreviousGoalsProps) {
  return (
    <section
      aria-labelledby="goals-previous-title"
      className="flex flex-col gap-3"
      data-goals-section="previous"
    >
      <h2 id="goals-previous-title" className="flex">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="goals-previous-panel"
          onClick={() => onExpandedChange(!expanded)}
          className="bo-section-label min-h-11 flex-1 cursor-pointer rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className="flex items-center gap-3">
            <span className="bo-section-label__title">{GOALS_COPY.previousTitle}</span>
            {/* A space, so the name never reads "Anteriores3". */}
            <span className="sr-only"> </span>
            <span className="bo-section-label__count">{goals.length}</span>
          </span>
          <Icon icon={ChevronDown} size="sm" className={cn(expanded && "rotate-180")} />
        </button>
      </h2>
      <div id="goals-previous-panel" hidden={!expanded} className="flex flex-col gap-3">
        <p className="bo-text-body-sm max-w-160 text-text-secondary">{GOALS_COPY.previousHelp}</p>
        <ul aria-label={GOALS_COPY.previousList} className="bo-list max-w-160">
          {goals.map((goal) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              today={today}
              canAdd={false}
              footer={
                goal.status === "archived" ? (
                  <div className="flex">
                    <Key
                      variant="ghost"
                      icon={ArchiveRestore}
                      aria-label={GOALS_COPY.reactivateRow(goal.title)}
                      onClick={() => onReactivate(goal)}
                    >
                      {GOALS_COPY.reactivate}
                    </Key>
                  </div>
                ) : null
              }
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
