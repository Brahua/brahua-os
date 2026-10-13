"use client";

import { Pencil, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { AREA_ICONS, Icon, Key, Led } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { CONFETTI_FROM, celebrateStreak } from "@/lib/celebrate";
import { formatDateKey } from "@/lib/time";
import { archiveGoal, deleteGoal, markGoalAchieved, reopenGoal, unarchiveGoal } from "../actions";
import type { DeletedGoal, GoalEntryItem, GoalItem } from "../goal-input";
import { applyGoalListChange } from "../goal-list-optimistic";
import { readGoal, sourceReached, unitOf } from "../goal-text";
import { GOALS_COPY } from "../goals-copy";
import { periodLabel, periodOf, periodPhase } from "../pace";
import { DELETED_PARAM, GOALS_PATH } from "../routes";
import { GoalBar } from "./goal-bar";
import { GoalSourceLinkText } from "./goal-source-link";
import { failureReason, useGoalsScreen } from "./goals-screen";
import { preloadAddEntry, useGoalEntries } from "./use-goal-entries";

const loadForm = () => import("./goal-form-sheet");
const GoalFormSheet = dynamic(() => loadForm().then((loaded) => loaded.GoalFormSheet));
const preloadForm = () => void loadForm();

type GoalDetailProps = {
  goal: GoalItem;
  /** The entries that were not undone, newest first (manual goals). */
  entries: GoalEntryItem[];
  headingId: string;
};

/**
 * A goal's page (SPEC-goals "Detalle"): its bar and pace, "+1" and "Sumar…" for a manual goal in
 * course, the history of its entries, and "Marcar lograda" / "Reabrir", "Archivar" / "Reactivar",
 * "Editar" and "Eliminar" (a confirmation first, then back to the list with "Deshacer").
 */
export function GoalDetail({ goal: saved, entries: history, headingId }: GoalDetailProps) {
  const { today, areas, sources, enqueue, toaster, announce } = useGoalsScreen();
  const { push } = toaster;
  const router = useRouter();
  const [list, apply] = useOptimistic([saved], applyGoalListChange);
  const goal = list[0] ?? saved;
  const [saving, startSaving] = useTransition();
  const period = periodOf(goal);
  const phase = periodPhase(period, today);
  const reading = readGoal(goal, today);
  const achieved = goal.status === "achieved";
  const archived = goal.status === "archived";
  const canAdd = goal.sourceKind === "manual" && !archived && phase === "current";
  const unit = unitOf(goal);
  // A habit or project goal whose source still reaches the target is achieved again by the next
  // read, so "Reabrir" isn't offered (the server refuses it too).
  const reopenBlocked = achieved && sourceReached({ ...goal, status: "active" });

  function notSaved(text: string, reason: string) {
    push({ title: GOALS_COPY.notSavedTitle, text: `${text} ${reason}`, tone: "error" });
  }

  const entries = useGoalEntries({
    view: list,
    apply,
    startSaving,
    notSaved,
    focusFallback: () => document.getElementById(headingId)?.focus(),
  });

  // ── Edit ──
  const [formOpening, setFormOpening] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const formReturn = useRef<HTMLElement | null>(null);

  // ── Achieved and reopened ──
  function setAchieved(next: boolean) {
    const patch = next
      ? ({ status: "achieved", achievedAt: new Date().toISOString() } as const)
      : ({ status: "active", achievedAt: null } as const);
    startSaving(async () => {
      apply({ type: "update", id: goal.id, patch });
      const queued = await enqueue(`goal-achieved:${goal.id}`, () =>
        next ? markGoalAchieved({ id: goal.id }) : reopenGoal({ id: goal.id }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(GOALS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(next ? GOALS_COPY.notAchieved : GOALS_COPY.notReopened, failureReason(result));
        return;
      }
      push({
        title: next ? GOALS_COPY.achievedTitle : GOALS_COPY.reopenedTitle,
        text: next ? GOALS_COPY.achievedMarked(goal.title) : GOALS_COPY.reopened(goal.title),
        action: { label: GOALS_COPY.undo, run: () => setAchieved(!next) },
      });
      if (next) void celebrateStreak(CONFETTI_FROM, goal.area?.color);
    });
  }

  // ── Archive and reactivate ──
  function setArchived(next: boolean, position: "end" | "original" = "end") {
    const restored = goal.achievedAt ? "achieved" : "active";
    startSaving(async () => {
      apply({ type: "update", id: goal.id, patch: { status: next ? "archived" : restored } });
      const queued = await enqueue(`goal-archive:${goal.id}`, () =>
        next ? archiveGoal({ id: goal.id }) : unarchiveGoal({ id: goal.id, position }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(GOALS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(next ? GOALS_COPY.notArchived : GOALS_COPY.notReactivated, failureReason(result));
        return;
      }
      push({
        title: next ? GOALS_COPY.archivedNoticeTitle : GOALS_COPY.reactivatedTitle,
        text: next ? GOALS_COPY.archivedNotice(goal.title) : GOALS_COPY.reactivated(goal.title),
        action: { label: GOALS_COPY.undo, run: () => setArchived(!next, "original") },
      });
    });
  }

  // ── Delete ──
  const [confirming, setConfirming] = useState(false);
  const deleting = useRef(false);
  const deleteKey = useRef<HTMLButtonElement>(null);
  // Cancelling the confirmation: focus goes back to the key that opened it, once it is there.
  const focusDeleteKey = useRef(false);
  useEffect(() => {
    if (!focusDeleteKey.current || !deleteKey.current) return;
    focusDeleteKey.current = false;
    deleteKey.current.focus();
  });

  function remove() {
    // One at a time: a second activation while it is on its way does nothing.
    if (deleting.current) return;
    deleting.current = true;
    startSaving(async () => {
      const queued = await enqueue(`goal-delete:${goal.id}`, () => deleteGoal({ id: goal.id }));
      deleting.current = false;
      if (queued.kind === "skipped" || queued.superseded) return;
      const result: ActionResult<DeletedGoal> =
        queued.kind === "done" ? queued.value : fail(GOALS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(GOALS_COPY.notDeleted, failureReason(result));
        return;
      }
      router.push(`${GOALS_PATH}?${DELETED_PARAM}=${goal.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-6" data-saving={saving ? "" : undefined}>
      <header className="flex flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Led area={goal.area?.color} on={achieved} />
          {goal.area ? <Icon icon={AREA_ICONS[goal.area.icon]} size="sm" aria-hidden /> : null}
          <span className="bo-text-label text-text-secondary">
            {GOALS_COPY.periodOf(periodLabel(period))}
            {goal.area ? ` · ${goal.area.name}` : ""}
          </span>
          {achieved ? (
            <span className="bo-text-label text-text-secondary">· {GOALS_COPY.achievedBadge}</span>
          ) : null}
          {archived ? (
            <span className="bo-text-label text-text-secondary">· {GOALS_COPY.archivedBadge}</span>
          ) : null}
        </div>
        {/* tabIndex -1: focus lands here when something leaves. */}
        <h1 id={headingId} tabIndex={-1} className="bo-text-display break-words outline-none">
          {goal.title}
        </h1>
      </header>

      <section aria-labelledby={headingId} className="flex max-w-160 flex-col gap-3">
        {reading.kind === "ok" ? (
          <>
            <GoalBar
              title={goal.title}
              value={reading.value}
              target={reading.target}
              count={reading.count}
              size="lg"
            />
            <p className="bo-text-title" data-goal-count="">
              {reading.count}
              <GoalSourceLinkText source={reading.source} />
            </p>
            {reading.line ? (
              <p className="bo-text-body text-text-secondary" data-goal-line="">
                {reading.line}
              </p>
            ) : null}
          </>
        ) : (
          <p className="bo-text-body text-text-secondary">{reading.line}</p>
        )}
        {canAdd ? (
          <div className="flex flex-wrap gap-2">
            <Key
              aria-label={GOALS_COPY.addOne(goal.title)}
              data-goal-add={goal.id}
              onClick={() => entries.add(goal, 1)}
            >
              {GOALS_COPY.add}
            </Key>
            <Key
              variant="ghost"
              aria-label={GOALS_COPY.addMoreLabel(goal.title)}
              onPointerEnter={preloadAddEntry}
              onFocus={preloadAddEntry}
              onClick={(event) => entries.openAdd(goal, event.currentTarget)}
            >
              {GOALS_COPY.addMore}
            </Key>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2">
        {archived ? null : (
          <Key
            variant="ghost"
            icon={Pencil}
            aria-haspopup="dialog"
            onPointerEnter={preloadForm}
            onFocus={preloadForm}
            onClick={(event) => {
              formReturn.current = event.currentTarget;
              setFormOpening((count) => count + 1);
              setFormOpen(true);
            }}
          >
            {GOALS_COPY.edit}
          </Key>
        )}
        {archived || reopenBlocked ? null : (
          <Key
            // Never `disabled` (it keeps focus): the label swaps in place.
            onClick={() => setAchieved(!achieved)}
          >
            {achieved ? GOALS_COPY.reopen : GOALS_COPY.markAchieved}
          </Key>
        )}
        <Key variant="ghost" onClick={() => setArchived(!archived)}>
          {archived ? GOALS_COPY.reactivate : GOALS_COPY.archive}
        </Key>
      </div>

      {goal.notes ? (
        <section aria-labelledby={`${headingId}-notes`} className="flex max-w-160 flex-col gap-2">
          <h2 id={`${headingId}-notes`} className="bo-text-title">
            {GOALS_COPY.notesTitle}
          </h2>
          <p className="bo-text-body whitespace-pre-line">{goal.notes}</p>
        </section>
      ) : null}

      {goal.sourceKind === "manual" ? (
        <section aria-labelledby={`${headingId}-history`} className="flex flex-col gap-3">
          <h2 id={`${headingId}-history`} className="bo-text-title">
            {GOALS_COPY.historyTitle}
          </h2>
          {history.length === 0 ? (
            <p className="bo-text-body-sm text-text-secondary">{GOALS_COPY.historyEmpty}</p>
          ) : (
            <ul aria-label={GOALS_COPY.historyList} className="bo-list max-w-160">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  data-goal-entry={entry.id}
                  className="bo-text-body flex min-h-12 items-center justify-between gap-3 bg-surface px-4 py-2"
                >
                  <span>{GOALS_COPY.entryLine(entry.delta, unit)}</span>
                  <time dateTime={entry.entryDate} className="bo-text-label text-text-secondary">
                    {formatDateKey(entry.entryDate, "short")}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="flex max-w-160 flex-col gap-3" data-goal-delete="">
        {confirming ? (
          <div
            role="group"
            aria-label={GOALS_COPY.confirmTitle(goal.title)}
            className="bo-card items-start"
          >
            <p className="bo-text-title">{GOALS_COPY.confirmTitle(goal.title)}</p>
            <p className="bo-text-body-sm text-text-secondary">{GOALS_COPY.confirmText}</p>
            <div className="flex flex-wrap gap-2">
              <Key
                variant="ghost"
                onClick={() => {
                  focusDeleteKey.current = true;
                  setConfirming(false);
                }}
              >
                {GOALS_COPY.keep}
              </Key>
              <Key autoFocus onClick={remove}>
                {GOALS_COPY.confirmDelete}
              </Key>
            </div>
          </div>
        ) : (
          <>
            <p className="bo-text-body-sm text-text-secondary">{GOALS_COPY.deleteHelp}</p>
            <Key
              ref={deleteKey}
              variant="ghost"
              icon={Trash2}
              className="w-fit"
              onClick={() => setConfirming(true)}
            >
              {GOALS_COPY.deleteGoal}
            </Key>
          </>
        )}
      </section>

      {formOpening > 0 ? (
        <GoalFormSheet
          key={`form-${formOpening}`}
          open={formOpen}
          onOpenChange={setFormOpen}
          areas={areas}
          sources={sources}
          goal={goal}
          today={today}
          returnFocusRef={formReturn}
          onCreated={(updated) => {
            setFormOpen(false);
            announce(GOALS_COPY.updated(updated.title));
          }}
        />
      ) : null}
      {entries.addSheet}
    </div>
  );
}
