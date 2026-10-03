"use client";

import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";
import { AreaTag, Icon, Key, StatNumber } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { deleteHabit } from "../actions";
import { monthLinks } from "../calendar";
import { frequencySummary } from "../frequency-input";
import type { HabitDayLog, HabitItem, HabitPauseSummary } from "../habit-input";
import { HABITS_COPY } from "../habits-copy";
import { dayStateText, HISTORY_COPY } from "../history-copy";
import { setHabitDone, setHabitQuantity } from "../log-actions";
import { measureSummary } from "../measure-input";
import { archiveHabit, unarchiveHabit } from "../organize-actions";
import { ORGANIZE_COPY } from "../organize-copy";
import { pauseHabit, removeHabitPause, resumeHabit } from "../pause-actions";
import { PAUSE_COPY } from "../pause-copy";
import type { PauseHabitInput } from "../pause-input";
import { DELETED_PARAM, HABITS_PATH, habitMonthHref } from "../routes";
import { addDays, isLoggableDay, otherLoggableDays } from "../schedule";
import {
  bestStreak,
  currentStreak,
  dayStatus,
  isPausedOn,
  monthCompliance,
  totalDone,
  type DayLog,
  type StreakHistory,
} from "../streak";
import type { OtherDay } from "./adjust-day-sheet";
import { HabitCalendar, type CalendarDay } from "./habit-calendar";
import { HabitPausesSection } from "./habit-pauses-section";
import { failureReason, useHabitsScreen } from "./habits-screen";
import { dayState, preloadAdjust } from "./use-quantity-log";

// The sheets load on demand (the same ones as "Hoy").
const AdjustDaySheet = dynamic(() =>
  import("./adjust-day-sheet").then((loaded) => loaded.AdjustDaySheet),
);
const PauseSheet = dynamic(() => import("./pause-sheet").then((loaded) => loaded.PauseSheet));
const loadForm = () => import("./habit-form-sheet");
const HabitFormSheet = dynamic(() => loadForm().then((loaded) => loaded.HabitFormSheet));
const preloadForm = () => void loadForm();

type HabitDetailProps = {
  /** The habit with today's log (its streak, its pause…). */
  habit: HabitItem;
  archived: boolean;
  /** The logs read: every marked day since its start, the last 7 days and the month's. */
  logs: HabitDayLog[];
  /** Every pause that isn't removed, by start date. */
  pauses: HabitPauseSummary[];
  /** The calendar's month, `YYYY-MM`. */
  month: string;
  headingId: string;
};

type PauseChange =
  | { type: "end"; id: string; endDate: string }
  | { type: "remove"; id: string }
  | { type: "add"; pause: HabitPauseSummary };

function applyPauseChange(list: HabitPauseSummary[], change: PauseChange): HabitPauseSummary[] {
  switch (change.type) {
    case "end":
      return list.map((pause) =>
        pause.id === change.id ? { ...pause, endDate: change.endDate } : pause,
      );
    case "remove":
      return list.filter((pause) => pause.id !== change.id);
    case "add":
      return [...list.filter((pause) => pause.id !== change.pause.id), change.pause].sort((a, b) =>
        a.startDate.localeCompare(b.startDate),
      );
  }
}

function applyLog(list: HabitDayLog[], log: HabitDayLog): HabitDayLog[] {
  return [...list.filter((entry) => entry.day !== log.day), log];
}

/** The sheet open: logging a day of the calendar. */
type Adjusting = { key: number; day: string; days: OtherDay[] };

/**
 * H5: a habit's page (SPEC-habits "Detalle"): its header (name, area, identity, cue, rule and
 * "Editar"), its stats (`StatNumber`: current and best streak, the month's compliance, the days
 * done in total), the monthly calendar (`HabitCalendar`; a day of the last 7 opens the adjust
 * sheet), its pauses and the actions (Archivar / Reactivar, Eliminar). Logging a day, resuming a
 * pause and archiving are optimistic, through the screen's queue, with "Deshacer" in the notice;
 * the stats and the calendar follow at once (they are computed here with the pure rules of
 * streak.ts from the history read).
 */
export function HabitDetail({ habit, archived, logs, pauses, month, headingId }: HabitDetailProps) {
  const { today, areas, enqueue, toaster, announce, isCurrentDay } = useHabitsScreen();
  const { push } = toaster;
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [logView, patchLog] = useOptimistic(logs, applyLog);
  const [pauseView, patchPause] = useOptimistic(pauses, applyPauseChange);
  const [archivedView, setArchivedView] = useOptimistic(archived);
  const ids = useId();
  const pausesHeadingId = `${ids}-pauses`;
  const monthTitleId = `${ids}-month`;
  const calendarHelpId = `${ids}-calendar-help`;
  const confirmTextId = `${ids}-confirm-text`;
  const deleteHelpId = `${ids}-delete-help`;
  const archiveHelpId = `${ids}-archive-help`;

  const history: StreakHistory = {
    logs: new Map<string, DayLog>(
      logView.map((log) => [log.day, { quantity: log.quantity, target: log.target }]),
    ),
    pauses: pauseView,
  };
  const avoid = habit.kind === "avoid";
  const byQuantity = !avoid && habit.measure === "quantity";
  const current = currentStreak(habit, history, today);
  const best = bestStreak(habit, history, today);
  const compliance = monthCompliance(habit, history, month, today);
  const total = totalDone(habit, history, today);
  const links = monthLinks(month, today, habit.startDate);

  function notSaved(text: string, reason: string) {
    push({ title: HABITS_COPY.notSavedTitle, text: `${text} ${reason}`, tone: "error" });
  }

  // ── The calendar's days ──

  /** A day's log as shown (0 and the habit's goal without one). */
  const logOf = (day: string) => {
    const log = history.logs.get(day);
    return { quantity: log?.quantity ?? 0, target: log?.target ?? habit.goal };
  };

  function dayOf(day: string): CalendarDay {
    const status = dayStatus(habit, history, day, today);
    const { quantity, target } = logOf(day);
    const state = dayStateText({
      status,
      kind: habit.kind,
      quantity: byQuantity ? quantity : null,
      target,
      unit: habit.unit,
    });
    return {
      status,
      fill: status === "partial" ? Math.min(quantity / target, 1) : 0,
      label: HISTORY_COPY.dayKey(day, day === today, state),
      loggable: !archivedView && isLoggableDay(day, today, habit.startDate),
    };
  }

  // ── Log a day (the adjust sheet, H4's, with today and the 7 days before) ──
  const [adjusting, setAdjusting] = useState<Adjusting | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const adjustReturn = useRef<HTMLElement | null>(null);

  function openDay(day: string, trigger: HTMLElement) {
    // A page read for another Lima day reloads: the 7 days moved.
    if (!isCurrentDay()) return;
    adjustReturn.current = trigger;
    const days = [today, ...otherLoggableDays(habit.startDate, today)]
      .filter((option) => option >= habit.startDate)
      .map((option) => ({ day: option, ...logOf(option), paused: isPausedOn(pauseView, option) }));
    setAdjusting((previous) => ({ key: (previous?.key ?? 0) + 1, day, days }));
    setAdjustOpen(true);
  }

  function saveDay(_: HabitItem, quantity: number, picked: OtherDay | null) {
    setAdjustOpen(false);
    if (!picked || quantity === picked.quantity) return;
    logDay(picked.day, quantity, picked.quantity);
  }

  /**
   * Logs a day (today or one of the 7 before): a quantity's exact amount, or a yes/no (a habit to
   * avoid: a relapse) marked when `quantity` > 0. Optimistic. `previous`: the day's quantity
   * before, for the notice's "Deshacer" (null: this is the undo, only announced).
   */
  function logDay(day: string, quantity: number, previous: number | null) {
    if (!isCurrentDay()) return;
    const { target } = logOf(day);
    const stored = byQuantity ? quantity : quantity > 0 ? 1 : 0;
    startSaving(async () => {
      patchLog({ day, quantity: stored, target });
      const queued = byQuantity
        ? await enqueue(`habit-qty:${habit.id}:${day}`, () =>
            setHabitQuantity({ id: habit.id, day, quantity }),
          )
        : await enqueue(`habit-day:${habit.id}:${day}`, () =>
            setHabitDone({ id: habit.id, day, done: quantity > 0 }),
          );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result: ActionResult<HabitItem> =
        queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(
          previous === null ? HABITS_COPY.notUndone : PAUSE_COPY.notLoggedOther,
          failureReason(result),
        );
        return;
      }
      const state = dayState(result.data);
      if (previous === null) {
        announce(PAUSE_COPY.loggedAgain(habit.name, day, state));
        return;
      }
      push({
        title: PAUSE_COPY.loggedTitle,
        text: PAUSE_COPY.logged(habit.name, day, state),
        action: { label: HABITS_COPY.undo, run: () => logDay(day, previous, null) },
      });
    });
  }

  // ── Pauses ──
  const [busyPauses, setBusyPauses] = useState<ReadonlySet<string>>(() => new Set());
  const busyNow = useRef(new Set<string>());

  function hold(id: string): boolean {
    if (busyNow.current.has(id)) return false;
    busyNow.current.add(id);
    setBusyPauses(new Set(busyNow.current));
    return true;
  }

  function release(id: string) {
    busyNow.current.delete(id);
    setBusyPauses(new Set(busyNow.current));
  }

  /**
   * "Reanudar" (a pause going on: it ends yesterday) or "Cancelar la pausa" (one that hasn't
   * started: removed). Optimistic; the notice's "Deshacer" pauses again. Focus goes to the
   * section's heading (the row's key changes or leaves).
   */
  function resume(pause: HabitPauseSummary) {
    if (!isCurrentDay() || !hold(pause.id)) return;
    const started = pause.startDate < today;
    document.getElementById(pausesHeadingId)?.focus();
    startSaving(async () => {
      try {
        patchPause(
          started
            ? { type: "end", id: pause.id, endDate: addDays(today, -1) }
            : { type: "remove", id: pause.id },
        );
        const queued = await enqueue(`habit-pause:${habit.id}`, () =>
          resumeHabit({ id: habit.id, pauseId: pause.id }),
        );
        if (queued.kind === "skipped" || queued.superseded) return;
        const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
        if (!result.ok) {
          notSaved(PAUSE_COPY.notResumed, failureReason(result));
          return;
        }
        const { outcome } = result.data;
        const again: PauseHabitInput = {
          id: habit.id,
          startDate: outcome === "ended" ? today : pause.startDate,
          endDate: pause.endDate,
          reason: pause.reason,
        };
        push({
          title: PAUSE_COPY.resumedTitle,
          text: started ? PAUSE_COPY.resumed(habit.name) : PAUSE_COPY.pauseCancelled(habit.name),
          action:
            outcome === "none"
              ? undefined
              : { label: HABITS_COPY.undo, run: () => pauseAgain(again) },
        });
      } finally {
        release(pause.id);
      }
    });
  }

  /** The "Deshacer" of "Reanudar": pauses again (optimistic). Only announced. */
  function pauseAgain(input: PauseHabitInput) {
    startSaving(async () => {
      patchPause({
        type: "add",
        pause: {
          id: `pending-${habit.id}`,
          startDate: input.startDate,
          endDate: input.endDate,
          reason: input.reason,
        },
      });
      const queued = await enqueue(`habit-pause:${habit.id}`, () => pauseHabit(input));
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (result.ok) announce(PAUSE_COPY.pauseBack(habit.name));
      else notSaved(HABITS_COPY.notUndone, failureReason(result));
    });
  }

  /** The "Deshacer" of "Pausar": removes that pause (optimistic). Only announced. */
  function removePause(pause: HabitPauseSummary) {
    startSaving(async () => {
      patchPause({ type: "remove", id: pause.id });
      const queued = await enqueue(`habit-pause:${habit.id}`, () =>
        removeHabitPause({ id: habit.id, pauseId: pause.id }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (result.ok) announce(PAUSE_COPY.pauseRemoved(habit.name));
      else notSaved(HABITS_COPY.notUndone, failureReason(result));
    });
  }

  // The "Pausar" sheet (H4's): not optimistic (an overlap is only known on the server).
  const [pausing, setPausing] = useState(0);
  const [pauseOpen, setPauseOpen] = useState(false);
  const pauseReturn = useRef<HTMLElement | null>(null);

  function openPause(trigger: HTMLElement) {
    pauseReturn.current = trigger;
    setPausing((value) => value + 1);
    setPauseOpen(true);
  }

  function onPaused(_: HabitItem, pause: HabitPauseSummary, input: PauseHabitInput) {
    const pausedToday = input.startDate <= today && today <= input.endDate;
    setPauseOpen(false);
    // The "Pausar" key leaves while paused today: focus goes to the section's heading.
    if (pausedToday) pauseReturn.current = document.getElementById(pausesHeadingId);
    push({
      title: PAUSE_COPY.pausedTitle,
      text: pausedToday
        ? PAUSE_COPY.paused(habit.name, input.endDate)
        : PAUSE_COPY.pausedAhead(habit.name, input.startDate, input.endDate),
      action: { label: HABITS_COPY.undo, run: () => removePause(pause) },
    });
  }

  // ── Archive and reactivate (optimistic; the same key, so focus stays on it) ──

  function setArchived(next: boolean, undoable: boolean) {
    startSaving(async () => {
      setArchivedView(next);
      const queued = await enqueue(`habit-archive:${habit.id}`, () =>
        next
          ? archiveHabit({ id: habit.id })
          : unarchiveHabit({ id: habit.id, position: undoable ? "end" : "original" }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      const result = queued.kind === "done" ? queued.value : fail(HABITS_COPY.checkConnection);
      if (!result.ok) {
        notSaved(
          undoable
            ? next
              ? ORGANIZE_COPY.notArchived
              : ORGANIZE_COPY.notReactivated
            : HABITS_COPY.notUndone,
          failureReason(result),
        );
        return;
      }
      if (!undoable) {
        announce(
          next ? ORGANIZE_COPY.archivedAgain(habit.name) : ORGANIZE_COPY.backInPlace(habit.name),
        );
        return;
      }
      push({
        title: next ? ORGANIZE_COPY.archivedNoticeTitle : ORGANIZE_COPY.reactivatedTitle,
        text: next
          ? ORGANIZE_COPY.archivedNotice(habit.name)
          : ORGANIZE_COPY.reactivated(habit.name),
        action: { label: HABITS_COPY.undo, run: () => setArchived(!next, false) },
      });
    });
  }

  // ── Delete (asks first when it has logged days; then back to the list with "Deshacer") ──
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDeleting] = useTransition();
  const deleteKey = useRef<HTMLButtonElement>(null);
  const confirmTitle = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<"confirm" | "delete" | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "confirm" ? confirmTitle.current : deleteKey.current)?.focus();
  });

  function askDelete() {
    if (deleting) return;
    if (!habit.hasLogs) {
      remove();
      return;
    }
    focusNext.current = "confirm";
    setConfirming(true);
  }

  function keep() {
    focusNext.current = "delete";
    setConfirming(false);
  }

  function remove() {
    if (deleting) return;
    startDeleting(async () => {
      let result: ActionResult<{ id: string }>;
      try {
        result = await deleteHabit({ id: habit.id });
      } catch {
        result = fail(HABITS_COPY.checkConnection);
      }
      if (!result.ok) {
        notSaved(HABITS_COPY.notDeleted, failureReason(result));
        return;
      }
      // `replace`: going back never lands on a 404. The list offers "Deshacer".
      router.replace(`${HABITS_PATH}?${DELETED_PARAM}=${habit.id}`);
    });
  }

  // ── Edit (the form of "Hoy", with "Más detalles") ──
  const [formOpening, setFormOpening] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const formReturn = useRef<HTMLElement | null>(null);
  const saved = useRef<HabitItem | null>(null);

  function openForm(trigger: HTMLElement) {
    formReturn.current = trigger;
    saved.current = null;
    setFormOpening((value) => value + 1);
    setFormOpen(true);
  }

  const unit = (count: number) => HISTORY_COPY.streakUnit(count, current.unit);
  const bestUnit = (count: number) => HISTORY_COPY.streakUnit(count, best.unit);

  return (
    <div
      className="flex max-w-180 flex-col gap-8"
      data-saving={saving || deleting ? "" : undefined}
    >
      <header className="flex flex-col gap-3">
        <h1 id={headingId} tabIndex={-1} className="bo-text-display break-words outline-none">
          {habit.name}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {habit.area ? (
            <AreaTag area={habit.area.color} icon={habit.area.icon} label={habit.area.name} />
          ) : null}
          <span className="bo-text-body-sm text-text-secondary" data-habit-rule="">
            {`${frequencySummary(habit)} · ${measureSummary(habit)}`}
          </span>
          <span className="bo-text-body-sm text-text-secondary">
            {HISTORY_COPY.startedOn(habit.startDate)}
          </span>
        </div>
        {habit.identity || habit.cue ? (
          <dl className="flex flex-col gap-1">
            {habit.identity ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="bo-text-label text-text-secondary">{HISTORY_COPY.identityLabel}</dt>
                <dd className="bo-text-body break-words" data-habit-identity="">
                  {habit.identity}
                </dd>
              </div>
            ) : null}
            {habit.cue ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="bo-text-label text-text-secondary">{HISTORY_COPY.cueLabel}</dt>
                <dd className="bo-text-body break-words" data-habit-cue="">
                  {habit.cue}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {archivedView ? (
          <p className="bo-card bo-text-body-sm" data-habit-archived="">
            {HISTORY_COPY.archivedNote}
          </p>
        ) : (
          <div>
            <Key
              icon={Pencil}
              aria-haspopup="dialog"
              onPointerEnter={preloadForm}
              onFocus={preloadForm}
              onTouchStart={preloadForm}
              onClick={(event) => openForm(event.currentTarget)}
            >
              {HISTORY_COPY.edit}
            </Key>
          </div>
        )}
      </header>

      <section aria-label={HISTORY_COPY.statsLabel}>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-habit-stats="">
          <Stat
            label={avoid ? HISTORY_COPY.cleanStreak : HISTORY_COPY.currentStreak}
            value={current.count}
            unit={unit(current.count)}
            name="current"
          />
          <Stat
            label={avoid ? HISTORY_COPY.bestClean : HISTORY_COPY.bestStreak}
            value={best.count}
            unit={bestUnit(best.count)}
            name="best"
          />
          <Stat
            label={HISTORY_COPY.monthCompliance}
            value={compliance.done}
            unit={HISTORY_COPY.ofTotal(compliance.expected)}
            name="month"
          />
          <Stat
            label={avoid ? HISTORY_COPY.totalCleanLabel : HISTORY_COPY.totalLabel}
            value={total}
            unit={HISTORY_COPY.totalUnit(total)}
            name="total"
          />
        </dl>
      </section>

      <section aria-labelledby={monthTitleId} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={monthTitleId} className="bo-text-title">
            <span className="sr-only">{HISTORY_COPY.calendarHeading}: </span>
            {HISTORY_COPY.monthTitle(month)}
          </h2>
          <nav aria-label={HISTORY_COPY.monthNav} className="flex gap-2">
            {links.previous ? (
              <Key asChild variant="ghost">
                <Link href={habitMonthHref(habit.id, links.previous)} prefetch={false} rel="prev">
                  <Icon icon={ChevronLeft} />
                  {HISTORY_COPY.previousMonth}
                </Link>
              </Key>
            ) : null}
            {links.next ? (
              <Key asChild variant="ghost">
                <Link href={habitMonthHref(habit.id, links.next)} prefetch={false} rel="next">
                  {HISTORY_COPY.nextMonth}
                  <Icon icon={ChevronRight} />
                </Link>
              </Key>
            ) : null}
          </nav>
        </div>
        <p id={calendarHelpId} className="bo-text-body-sm text-text-secondary">
          {archivedView ? HISTORY_COPY.calendarHelpArchived : HISTORY_COPY.calendarHelp}
        </p>
        <div onPointerEnter={preloadAdjust} onFocus={preloadAdjust}>
          <HabitCalendar
            key={month}
            month={month}
            today={today}
            dayOf={dayOf}
            onOpenDay={openDay}
            labelledBy={monthTitleId}
            describedBy={calendarHelpId}
          />
        </div>
      </section>

      <HabitPausesSection
        pauses={pauseView}
        today={today}
        archived={archivedView}
        headingId={pausesHeadingId}
        isBusy={(pause) => busyPauses.has(pause.id) || pause.id.startsWith("pending-")}
        onPause={openPause}
        onResume={resume}
      />

      <section aria-labelledby={`${ids}-actions`} className="flex flex-col gap-4">
        <h2 id={`${ids}-actions`} className="bo-text-title">
          {HISTORY_COPY.actionsHeading}
        </h2>
        <div className="flex flex-col items-start gap-2">
          <Key
            variant="ghost"
            icon={archivedView ? ArchiveRestore : Archive}
            aria-describedby={archiveHelpId}
            data-habit-archive=""
            onClick={() => setArchived(!archivedView, true)}
          >
            {archivedView ? HISTORY_COPY.reactivate : HISTORY_COPY.archive}
          </Key>
          <p id={archiveHelpId} className="bo-text-body-sm text-text-secondary">
            {archivedView ? HISTORY_COPY.reactivateHelp : HISTORY_COPY.archiveHelp}
          </p>
        </div>
        {confirming ? (
          <div className="flex flex-col gap-3">
            <h3 ref={confirmTitle} tabIndex={-1} className="bo-text-body-strong outline-none">
              {HABITS_COPY.confirmTitle(habit.name)}
            </h3>
            <p id={confirmTextId} className="bo-text-body-sm text-text-secondary">
              {HABITS_COPY.confirmText}
            </p>
            <div className="flex flex-wrap gap-2">
              <Key
                variant="signal"
                icon={Trash2}
                aria-describedby={confirmTextId}
                aria-disabled={deleting || undefined}
                onClick={remove}
              >
                {deleting ? HISTORY_COPY.deleting : HABITS_COPY.confirmDelete}
              </Key>
              <Key
                variant="ghost"
                aria-disabled={deleting || undefined}
                onClick={() => !deleting && keep()}
              >
                {HABITS_COPY.keep}
              </Key>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <Key
              ref={deleteKey}
              variant="ghost"
              icon={Trash2}
              aria-describedby={deleteHelpId}
              aria-disabled={deleting || undefined}
              onClick={askDelete}
            >
              {deleting ? HISTORY_COPY.deleting : HABITS_COPY.deleteHabit}
            </Key>
            <p id={deleteHelpId} className="bo-text-body-sm text-text-secondary">
              {HISTORY_COPY.deleteHelp}
            </p>
          </div>
        )}
        <p role="status" className="sr-only">
          {deleting ? HISTORY_COPY.deleting : ""}
        </p>
      </section>

      {adjusting ? (
        <AdjustDaySheet
          key={`adjust-${adjusting.key}`}
          open={adjustOpen}
          onOpenChange={setAdjustOpen}
          habit={habit}
          days={adjusting.days}
          initialDay={adjusting.day}
          returnFocusRef={adjustReturn}
          onSave={saveDay}
        />
      ) : null}

      {pausing > 0 ? (
        <PauseSheet
          key={`pause-${pausing}`}
          open={pauseOpen}
          onOpenChange={setPauseOpen}
          habit={habit}
          today={today}
          canSave={isCurrentDay}
          returnFocusRef={pauseReturn}
          onPaused={onPaused}
        />
      ) : null}

      {formOpening > 0 ? (
        <HabitFormSheet
          key={`form-${formOpening}`}
          open={formOpen}
          onOpenChange={setFormOpen}
          areas={areas}
          habit={habit}
          returnFocusRef={formReturn}
          onCreated={(habitSaved) => {
            saved.current = habitSaved;
            setFormOpen(false);
          }}
          onClosed={() => {
            const done = saved.current;
            saved.current = null;
            if (done) announce(ORGANIZE_COPY.updated(done.name));
          }}
        />
      ) : null}
    </div>
  );
}

/** One stat: a `StatNumber` (its figure animates) named by its label. */
function Stat({
  label,
  value,
  unit,
  name,
}: {
  label: string;
  value: number;
  unit: string;
  name: string;
}) {
  return (
    <div className="flex flex-col-reverse gap-1" data-habit-stat={name}>
      <dt className="bo-stat__label">{label}</dt>
      <dd>
        <StatNumber value={value} unit={unit} />
      </dd>
    </div>
  );
}
