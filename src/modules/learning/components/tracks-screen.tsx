"use client";

import { Check, ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState } from "react";
import { Icon, Key, SectionLabel } from "@/design-system";
import { cn } from "@/lib/cn";
import { ownerDateKey } from "@/lib/time";
import { MAX_ACTIVE_TRACKS } from "../learning-constants";
import { KIND_LABELS, LEARNING_COPY as COPY } from "../learning-copy";
import { paceToDate } from "../pace";
import { trackPath } from "../routes";
import { markStepDone, undoMarkStepDone } from "../steps-actions";
import { STEPS_COPY } from "../steps-copy";
import type { StepDoneResult } from "../steps-input";
import type { ProjectChoice, TrackItem } from "../tracks-input";
import { TrackFormSheet, type TrackFormSaved } from "./track-form-sheet";
import { TrackProgress } from "./track-progress";
import { useLearningSave } from "./use-learning-save";

type TracksScreenProps = {
  tracks: TrackItem[];
  projects: ProjectChoice[];
  /** Lima's today (YYYY-MM-DD): the pace is read for it. */
  today: string;
  /** Id of the page's `<h1>` (focus lands there after a delete). */
  headingId: string;
};

/** A step checked from a card: the track's counts and «Sigue con» move at once. */
type CardChange = { trackId: string; stepId: string };

function applyCardChange(tracks: TrackItem[], { trackId, stepId }: CardChange): TrackItem[] {
  return tracks.map((track) =>
    track.id === trackId && track.upcoming[0]?.id === stepId
      ? {
          ...track,
          steps: { done: track.steps.done + 1, total: track.steps.total },
          upcoming: track.upcoming.slice(1),
        }
      : track,
  );
}

const cardSelector = (id: string) => `[data-track-card="${CSS.escape(id)}"] [data-track-link]`;
const doneKeySelector = (id: string) => `[data-track-done="${CSS.escape(id)}"]`;

/**
 * /learning (SPEC-learning "Pantallas"): «En curso» on top (up to 2 cards: «Sigue con» and its
 * «Hecho», the bar, the weekly target and the pace to the date), then «En espera» and «Terminados»
 * folded. «Nuevo frente» opens the sheet. Empty: «¿Qué quieres aprender?».
 */
export function TracksScreen({ tracks, projects, today, headingId }: TracksScreenProps) {
  const { save, toaster, announce, saving } = useLearningSave();
  const [view, applyChange] = useOptimistic(tracks, applyCardChange);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const opener = useRef<HTMLButtonElement | null>(null);
  const created = useRef<TrackFormSaved | null>(null);

  // Element to focus after the next render (a card's «Hecho» went away).
  const pendingFocus = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const find = pendingFocus.current;
    if (!find) return;
    pendingFocus.current = null;
    find()?.focus();
  });

  const active = view.filter((track) => track.status === "active");
  const waiting = view.filter((track) => track.status === "waiting");
  const done = view.filter((track) => track.status === "done");

  function openSheet(from: HTMLButtonElement) {
    opener.current = from;
    setSheetKey((key) => key + 1);
    setSheetOpen(true);
  }

  function sheetClosed() {
    const saved = created.current;
    created.current = null;
    if (saved?.kind !== "create") return;
    const { track, changes } = saved.data;
    const paused = changes.find((change) => change.id !== track.id);
    toaster.push({
      title: COPY.createdTitle,
      text: paused
        ? COPY.swapped(paused.title, track.title)
        : COPY.created(track.title, track.status),
    });
  }

  function checkNext(track: TrackItem) {
    const step = track.upcoming[0];
    if (!step) return;
    // The last step: its «Hecho» goes away, focus goes to the card's title.
    if (track.upcoming.length === 1)
      pendingFocus.current = () => document.querySelector(cardSelector(track.id));
    save<StepDoneResult>({
      apply: () => applyChange({ trackId: track.id, stepId: step.id }),
      key: null,
      call: () => markStepDone({ trackId: track.id, id: step.id, done: true }),
      failure: STEPS_COPY.notSaved.check,
      onSuccess: (result) => {
        toaster.push({
          title: STEPS_COPY.doneTitle,
          text: STEPS_COPY.doneNotice(step.title),
          action: {
            label: COPY.undo,
            run: () =>
              save({
                key: null,
                call: () =>
                  undoMarkStepDone({
                    trackId: track.id,
                    id: step.id,
                    expected: result.step.doneAt,
                    restore: result.previous,
                  }),
                failure: COPY.notUndone,
                onSuccess: () => {
                  announce(STEPS_COPY.undoneNotice(step.title));
                  pendingFocus.current = () => document.querySelector(doneKeySelector(track.id));
                },
              }),
          },
        });
      },
    });
  }

  return (
    <div className="flex flex-col gap-8" data-saving={saving || undefined}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={headingId} tabIndex={-1} className="bo-text-display outline-none">
          {COPY.pageTitle}
        </h1>
        {view.length > 0 ? (
          <Key
            variant="signal"
            icon={Plus}
            data-track-new=""
            onClick={(event) => openSheet(event.currentTarget)}
          >
            {COPY.newTrack}
          </Key>
        ) : null}
      </header>

      {view.length === 0 ? (
        <section className="flex max-w-160 flex-col items-start gap-4" data-tracks-empty="">
          <h2 className="bo-text-title">{COPY.emptyTitle}</h2>
          <p className="bo-text-body text-text-secondary">{COPY.emptyText}</p>
          <Key variant="signal" icon={Plus} onClick={(event) => openSheet(event.currentTarget)}>
            {COPY.emptyAction}
          </Key>
        </section>
      ) : (
        <>
          <section
            aria-labelledby="tracks-active-title"
            className="flex flex-col gap-3"
            data-tracks-section="active"
          >
            <SectionLabel
              id="tracks-active-title"
              as="h2"
              title={COPY.activeTitle}
              count={COPY.activeCount(active.length)}
              aria-label={COPY.activeName(active.length)}
            />
            <p className="bo-text-body-sm max-w-160 text-text-secondary">
              {active.length === 0 ? COPY.activeEmpty : COPY.activeHelp}
            </p>
            {active.length > 0 ? (
              <ul
                aria-label={COPY.listName(COPY.activeTitle)}
                className="grid max-w-240 gap-4 md:grid-cols-2"
              >
                {active.map((track) => (
                  <TrackCard key={track.id} track={track} today={today} onDone={checkNext} />
                ))}
              </ul>
            ) : null}
          </section>
          <FoldedTracks
            id="waiting"
            title={COPY.waitingTitle}
            help={COPY.waitingHelp}
            tracks={waiting}
          />
          <FoldedTracks id="done" title={COPY.doneTitle} help={COPY.doneHelp} tracks={done} />
        </>
      )}

      <TrackFormSheet
        key={sheetKey}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        returnFocusRef={opener}
        mode={{
          kind: "create",
          active: active.slice(0, MAX_ACTIVE_TRACKS).map(({ id, title }) => ({ id, title })),
        }}
        projects={projects}
        onSaved={(saved) => {
          created.current = saved;
        }}
        onClosed={sheetClosed}
      />
    </div>
  );
}

/** A track in progress (SPEC-learning "Pantallas"): its next step and «Hecho», the bar and pace. */
function TrackCard({
  track,
  today,
  onDone,
}: {
  track: TrackItem;
  today: string;
  onDone: (track: TrackItem) => void;
}) {
  const next = track.upcoming[0] ?? null;
  const pace = paceToDate({ targetDate: track.targetDate, today, ...track.steps });
  return (
    <li data-track-card={track.id} className="bo-card flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="bo-text-label text-text-secondary">{KIND_LABELS[track.kind]}</span>
        <Link
          href={trackPath(track.id)}
          data-track-link=""
          className="bo-text-title line-clamp-2 min-w-0 rounded-sm break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {track.title}
        </Link>
      </div>
      {track.kind === "practice" ? (
        <p className="bo-text-body-sm text-text-secondary">{COPY.practiceNote}</p>
      ) : track.steps.total === 0 ? (
        <p className="bo-text-body-sm text-text-secondary">{COPY.noSyllabus}</p>
      ) : next ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <p className="bo-text-body min-w-0 flex-1 break-words" data-track-next="">
            <span className="bo-text-label block text-text-secondary">{COPY.next}</span>
            {next.title}
          </p>
          <Key
            icon={Check}
            aria-label={STEPS_COPY.doneName(next.title)}
            data-track-done={track.id}
            onClick={() => onDone(track)}
          >
            {STEPS_COPY.done}
          </Key>
        </div>
      ) : (
        <p className="bo-text-body-sm text-text-secondary">{COPY.allDone}</p>
      )}
      {track.steps.total > 0 ? (
        <TrackProgress title={track.title} done={track.steps.done} total={track.steps.total} />
      ) : null}
      {track.weeklyTargetMinutes !== null || pace ? (
        <div className="flex flex-col gap-1">
          {track.weeklyTargetMinutes !== null ? (
            <p className="bo-text-body-sm text-text-secondary">
              {COPY.weeklyTarget(track.weeklyTargetMinutes)}
            </p>
          ) : null}
          {pace ? (
            <p className="bo-text-body-sm text-text-secondary" data-track-pace="">
              {COPY.pace(pace, today)}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** «En espera» and «Terminados»: folded by default, a row per track. Hidden when empty. */
function FoldedTracks({
  id,
  title,
  help,
  tracks,
}: {
  id: "waiting" | "done";
  title: string;
  help: string;
  tracks: TrackItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (tracks.length === 0) return null;
  const panelId = `tracks-${id}-panel`;
  const label = COPY.groupName(title, tracks.length);
  return (
    <section
      aria-labelledby={`tracks-${id}-title`}
      className="flex flex-col gap-3"
      data-tracks-section={id}
    >
      <h2 id={`tracks-${id}-title`} aria-label={label} className="flex">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={label}
          onClick={() => setExpanded((value) => !value)}
          className="bo-section-label min-h-11 flex-1 cursor-pointer rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className="flex items-center gap-3">
            <span className="bo-section-label__title">{title}</span>
            <span className="bo-section-label__count">{tracks.length}</span>
          </span>
          <Icon icon={ChevronDown} size="sm" className={cn(expanded && "rotate-180")} />
        </button>
      </h2>
      <div id={panelId} hidden={!expanded} className="flex flex-col gap-3">
        <p className="bo-text-body-sm max-w-160 text-text-secondary">{help}</p>
        <ul aria-label={COPY.listName(title)} className="bo-list max-w-160">
          {tracks.map((track) => (
            <li
              key={track.id}
              data-track-row={track.id}
              className="flex min-w-0 flex-col gap-2 bg-surface px-4 py-3"
            >
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <Link
                  href={trackPath(track.id)}
                  className="bo-text-body line-clamp-2 min-w-0 rounded-sm font-medium break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {track.title}
                </Link>
                <span className="bo-text-label shrink-0 text-text-secondary">
                  {KIND_LABELS[track.kind]}
                </span>
              </div>
              {track.steps.total > 0 ? (
                <TrackProgress
                  title={track.title}
                  done={track.steps.done}
                  total={track.steps.total}
                />
              ) : null}
              {track.finishedAt ? (
                <p className="bo-text-body-sm text-text-secondary">
                  {COPY.finishedOn(ownerDateKey(new Date(track.finishedAt)))}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
