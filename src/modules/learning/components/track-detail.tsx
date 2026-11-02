"use client";

import {
  CircleCheck,
  ExternalLink,
  FolderKanban,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useOptimistic, useRef, useState } from "react";
import { Icon, Key } from "@/design-system";
import { celebrate } from "@/lib/celebrate";
// Route helpers only (client-safe): `learning` may import `projects`' contracts and routes.
import { projectPath } from "@/modules/projects/routes";
import { MAX_ACTIVE_TRACKS, type TrackStatus } from "../learning-constants";
import { LEARNING_COPY as COPY } from "../learning-copy";
import { paceToDate } from "../pace";
import { DELETED_PARAM, LEARNING_PATH } from "../routes";
import type { StepItem } from "../steps-input";
import { applyStepChange } from "../steps-optimistic";
import { stepCounts } from "../syllabus";
import { trackDomain } from "../track-url";
import { changeStatus, deleteTrack, undoStatus } from "../tracks-actions";
import type { ProjectChoice, StatusChange, TrackItem, TrackRef } from "../tracks-input";
import { StepsSection } from "./steps-section";
import { TrackFormSheet } from "./track-form-sheet";
import { TrackProgress } from "./track-progress";
import { failureReason, useLearningSave } from "./use-learning-save";

type TrackDetailProps = {
  track: TrackItem;
  steps: StepItem[];
  /** The projects the settings can pick (the linked one included). */
  projects: ProjectChoice[];
  /** The linked project's name, or null (none, or no longer there). */
  projectName: string | null;
  /** The tracks in progress (the limit's offer names the others). */
  active: TrackRef[];
  /** Lima's today (YYYY-MM-DD): the pace is read for it. */
  today: string;
  /** Id of the `<h1>`. */
  headingId: string;
  /** The «Sesiones» slot (L2 fills it); nothing in L1. */
  sessions?: React.ReactNode;
};

/**
 * A track's page (SPEC-learning "Detalle"): its kind and status with their actions («Poner en
 * curso», «Pasar a espera», «Terminar», «Reabrir», «Ajustes», «Eliminar»), the bar, the pace to the
 * date, the syllabus and, from L2, the sessions. Putting a third one in progress offers to move
 * one to «En espera» instead of failing.
 */
export function TrackDetail({
  track,
  steps: serverSteps,
  projects,
  projectName,
  active,
  today,
  headingId,
  sessions = null,
}: TrackDetailProps) {
  const router = useRouter();
  const { send, toaster } = useLearningSave();
  const [steps, applyChange] = useOptimistic(serverSteps, applyStepChange);
  const counts = stepCounts(steps);
  const pace = paceToDate({ targetDate: track.targetDate, today, ...counts });
  const domain = track.url ? trackDomain(track.url) : null;
  const others = active.filter((item) => item.id !== track.id);
  const syllabusDone = counts.total > 0 && counts.done === counts.total;

  const [busy, setBusy] = useState(false);
  const [offerFor, setOfferFor] = useState<"active" | null>(null);
  const offerHeading = useId();
  const offerOpener = useRef<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsKey, setSettingsKey] = useState(0);
  const settingsKeyRef = useRef<HTMLButtonElement>(null);
  const savedSettings = useRef(false);

  // Element to focus after the next render (the offer opened or closed).
  const pendingFocus = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const find = pendingFocus.current;
    if (!find) return;
    pendingFocus.current = null;
    find()?.focus();
  });

  function closeOffer() {
    setOfferFor(null);
    const opener = offerOpener.current;
    pendingFocus.current = () => opener;
  }

  async function changeTo(to: TrackStatus, from: HTMLElement | null, pauseTrackId?: string) {
    if (busy) return;
    if (to === "active" && !pauseTrackId && others.length >= MAX_ACTIVE_TRACKS) {
      offerOpener.current = from;
      setOfferFor("active");
      pendingFocus.current = () => document.getElementById(offerHeading);
      return;
    }
    setBusy(true);
    const result = await send(() => changeStatus({ id: track.id, to, pauseTrackId }));
    setBusy(false);
    if (!result.ok) {
      if (result.fieldErrors?.pauseTrackId) {
        // The list was stale (another one went in progress meanwhile): the offer, with the
        // current tracks the revalidation brings.
        offerOpener.current = from;
        setOfferFor("active");
        pendingFocus.current = () => document.getElementById(offerHeading);
      }
      toaster.push({
        title: COPY.notSavedTitle,
        text: `${COPY.notSaved.status} ${failureReason(result)}`,
        tone: "error",
      });
      return;
    }
    const { changes } = result.data;
    if (pauseTrackId) {
      setOfferFor(null);
      pendingFocus.current = () => document.getElementById(headingId);
    }
    if (changes.length === 0) return;
    if (to === "done") void celebrate();
    const paused = changes.find((change) => change.id !== track.id);
    toaster.push({
      title: to === "done" ? COPY.finishedTitle : COPY.statusTitle,
      text: paused ? COPY.swapped(paused.title, track.title) : COPY.statusChanged(track.title, to),
      action: { label: COPY.undo, run: () => undoChanges(changes) },
    });
  }

  async function undoChanges(changes: StatusChange[]) {
    const result = await send(() => undoStatus({ changes }));
    if (result.ok) {
      toaster.push({ title: COPY.undoneTitle, text: COPY.statusRestored });
      return;
    }
    toaster.push({
      title: COPY.notSavedTitle,
      text: `${COPY.notUndone} ${failureReason(result)}`,
      tone: "error",
    });
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    const result = await send(() => deleteTrack({ id: track.id }));
    if (!result.ok) {
      setBusy(false);
      toaster.push({
        title: COPY.notSavedTitle,
        text: `${COPY.notSaved.delete} ${failureReason(result)}`,
        tone: "error",
      });
      return;
    }
    router.push(`${LEARNING_PATH}?${DELETED_PARAM}=${track.id}`);
  }

  const statusKeys: { to: TrackStatus; label: string; icon: typeof Play; signal?: boolean }[] =
    track.status === "active"
      ? [
          { to: "done", label: COPY.finish, icon: CircleCheck, signal: syllabusDone },
          { to: "waiting", label: COPY.pause, icon: Pause },
        ]
      : track.status === "waiting"
        ? [
            { to: "active", label: COPY.activate, icon: Play, signal: true },
            { to: "done", label: COPY.finish, icon: CircleCheck },
          ]
        : [{ to: "active", label: COPY.reopen, icon: RotateCcw }];

  return (
    <article className="flex flex-col gap-8" data-track={track.id} data-track-status={track.status}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="bo-text-label text-text-secondary" data-track-status-line="">
            {COPY.statusLine(track.kind, track.status)}
          </p>
          <h1 id={headingId} tabIndex={-1} className="bo-text-display break-words outline-none">
            {track.title}
          </h1>
        </div>
        {projectName || domain || track.finishedAt ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {track.projectId && projectName ? (
              <li>
                <Link
                  href={projectPath(track.projectId)}
                  aria-label={`${COPY.project}: ${projectName}`}
                  className="bo-text-body-sm inline-flex min-h-11 items-center gap-2 rounded-md text-text-secondary underline-offset-4 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <Icon icon={FolderKanban} size="sm" />
                  {projectName}
                </Link>
              </li>
            ) : null}
            {track.url && domain ? (
              <li>
                <a
                  href={track.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={COPY.linkName(domain)}
                  className="bo-text-body-sm inline-flex min-h-11 items-center gap-2 rounded-md text-text-secondary underline-offset-4 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <Icon icon={ExternalLink} size="sm" />
                  {domain}
                </a>
              </li>
            ) : null}
          </ul>
        ) : null}

        {counts.total > 0 ? (
          <TrackProgress title={track.title} done={counts.done} total={counts.total} size="lg" />
        ) : null}
        <div className="flex flex-col gap-1">
          {track.weeklyTargetMinutes !== null ? (
            <p className="bo-text-body-sm text-text-secondary">
              {COPY.weeklyTarget(track.weeklyTargetMinutes)}
            </p>
          ) : null}
          {track.targetDate ? (
            <p className="bo-text-body-sm text-text-secondary">
              {COPY.targetDate(track.targetDate)}
            </p>
          ) : null}
          {pace ? (
            <p className="bo-text-body-sm text-text-secondary" data-track-pace="">
              {COPY.pace(pace, today)}
            </p>
          ) : null}
          {track.kind === "practice" ? (
            <p className="bo-text-body-sm text-text-secondary">{COPY.practiceNote}</p>
          ) : null}
        </div>

        {syllabusDone && track.status !== "done" ? (
          <p className="bo-text-body" data-track-finish-offer="">
            {COPY.finishOffer}
          </p>
        ) : null}

        <div role="group" aria-label={COPY.actionsLabel} className="flex flex-wrap gap-2">
          {statusKeys.map((key) => (
            <Key
              key={key.to}
              variant={key.signal ? "signal" : "default"}
              icon={key.icon}
              aria-disabled={busy || undefined}
              data-track-action={key.to}
              onClick={(event) => void changeTo(key.to, event.currentTarget)}
            >
              {key.label}
            </Key>
          ))}
          <Key
            ref={settingsKeyRef}
            variant="ghost"
            icon={Settings2}
            data-track-settings=""
            onClick={() => {
              setSettingsKey((value) => value + 1);
              setSettingsOpen(true);
            }}
          >
            {COPY.settings}
          </Key>
          <Key
            variant="ghost"
            icon={Trash2}
            aria-disabled={busy || undefined}
            data-track-delete=""
            onClick={() => void remove()}
          >
            {COPY.deleteTrack}
          </Key>
        </div>

        {offerFor ? (
          <section
            aria-labelledby={offerHeading}
            className="bo-card flex max-w-160 flex-col gap-3"
            data-track-limit-offer=""
            onKeyDown={(event) => {
              if (event.key !== "Escape" || event.defaultPrevented) return;
              event.preventDefault();
              event.stopPropagation();
              closeOffer();
            }}
          >
            <h2 id={offerHeading} tabIndex={-1} className="bo-text-title outline-none">
              {COPY.limitTitle}
            </h2>
            <p className="bo-text-body-sm text-text-secondary">{COPY.limitText(track.title)}</p>
            <div className="flex flex-col items-start gap-2">
              {others.map((other) => (
                <Key
                  key={other.id}
                  icon={Pause}
                  aria-disabled={busy || undefined}
                  data-track-pause={other.id}
                  onClick={() => void changeTo("active", offerOpener.current, other.id)}
                >
                  {COPY.limitPause(other.title)}
                </Key>
              ))}
              <Key variant="ghost" onClick={closeOffer}>
                {COPY.limitCancel}
              </Key>
            </div>
          </section>
        ) : null}
      </header>

      {track.kind === "practice" ? null : (
        <StepsSection trackId={track.id} steps={steps} applyChange={applyChange} />
      )}

      {sessions}

      <TrackFormSheet
        key={settingsKey}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        returnFocusRef={settingsKeyRef}
        mode={{ kind: "edit", track }}
        projects={projects}
        onSaved={() => {
          savedSettings.current = true;
        }}
        onClosed={() => {
          if (!savedSettings.current) return;
          savedSettings.current = false;
          toaster.push({ title: COPY.savedTitle, text: COPY.saved(track.title) });
        }}
      />
    </article>
  );
}
