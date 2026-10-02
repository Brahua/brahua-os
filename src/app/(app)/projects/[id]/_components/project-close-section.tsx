"use client";

import { Ban, CircleCheck, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Icon, Key, SectionLabel } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { formatOwnerDay } from "@/lib/time";
import { closeProject, reopenProject } from "@/modules/projects/close-actions";
import type { MilestoneCounts } from "@/modules/projects/milestone-input";
import { isClosed, openWork, type ClosedStatus } from "@/modules/projects/project-close";
import type { ProgressCounts } from "@/modules/projects/progress-source";
import type { ProjectStatus } from "@/modules/projects/project-constants";
import { CLOSE_COPY, PROJECTS_COPY } from "@/modules/projects/projects-copy";
import { useMilestoneCounts } from "./milestone-progress";
import { useProjectDetail } from "./project-detail-context";

type Step = ClosedStatus | "reopen";
/** The keys focus can go to: the step's "Volver", or the key that opens a step. */
type FocusTarget = "back" | "done" | "canceled" | "reopen";

type ProjectCloseSectionProps = {
  /** The milestones as the server sent them (the section's live counts win once published). */
  counts: MilestoneCounts;
  /** What the progress sources (tasks, P6) count for the project. */
  contributed?: ProgressCounts;
};

/**
 * "Cerrar proyecto" (Checkpoint final): Terminado and Cancelado are not in the state picker but
 * here, each with a confirm step on the page (like Eliminar). Marking as done warns about open
 * work (milestones not done, plus what the progress sources count as not done) but never blocks
 * it. A closed project shows its state and "Reabrir", which takes it back to Activo.
 *
 * Not optimistic: the step waits for the server (`aria-disabled` keys and a status line), then the
 * revalidated page swaps the block, focus goes to the key of the new state and the result is
 * announced. A step only shows for the state it was opened in, so a change from elsewhere (another
 * tab) never leaves a stale one on screen.
 */
export function ProjectCloseSection({ counts, contributed }: ProjectCloseSectionProps) {
  const { project, announce } = useProjectDetail();
  const milestones = useMilestoneCounts(project.id, counts);
  const closed = isClosed(project.status);
  const [step, setStep] = useState<{ kind: Step; status: ProjectStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = useId();
  const headingId = `${ids}-heading`;

  const backKey = useRef<HTMLButtonElement>(null);
  const doneKey = useRef<HTMLButtonElement>(null);
  const cancelKey = useRef<HTMLButtonElement>(null);
  const reopenKey = useRef<HTMLButtonElement>(null);
  // Where focus goes once the key exists: the one that had it unmounts in every case.
  const focusNext = useRef<FocusTarget | null>(null);
  const shown = step && step.status === project.status ? step.kind : null;

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    const keys = { back: backKey, done: doneKey, canceled: cancelKey, reopen: reopenKey };
    const key = keys[target].current;
    if (!key) return;
    focusNext.current = null;
    key.focus();
  });

  function open(kind: Step) {
    setError(null);
    focusNext.current = "back";
    setStep({ kind, status: project.status });
  }

  function dismiss() {
    if (pending || !shown) return;
    focusNext.current = shown;
    setStep(null);
  }

  function confirm() {
    if (pending || !shown) return;
    const kind = shown;
    const name = project.name;
    setError(null);
    startTransition(async () => {
      let message: string;
      let result: ActionResult<unknown>;
      try {
        if (kind === "reopen") {
          result = await reopenProject({ id: project.id });
          message = CLOSE_COPY.reopened(name);
        } else {
          const closing = await closeProject({ id: project.id, status: kind });
          result = closing;
          message = closing.ok
            ? kind === "done"
              ? CLOSE_COPY.done(name, closing.data.open)
              : CLOSE_COPY.canceled(name)
            : "";
        }
      } catch {
        result = fail(PROJECTS_COPY.unexpected);
        message = "";
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The revalidated page swaps the block; focus then goes to the new state's key.
      focusNext.current = kind === "reopen" ? "done" : "reopen";
      startTransition(() => setStep(null));
      announce(message);
    });
  }

  const completedAt = project.status === "done" ? project.completedAt : null;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 border-t border-divider pt-6"
      data-close-section
    >
      <SectionLabel id={headingId} as="h2" title={CLOSE_COPY.section} />
      {closed ? (
        <>
          <p className="bo-text-body-strong" data-closed-state={project.status}>
            {completedAt
              ? CLOSE_COPY.doneState(formatOwnerDay(completedAt))
              : CLOSE_COPY.canceledState}
          </p>
          <p className="bo-text-body-sm text-text-secondary">{CLOSE_COPY.closedHelp}</p>
        </>
      ) : (
        <p className="bo-text-body-sm text-text-secondary">{CLOSE_COPY.help}</p>
      )}

      {shown ? (
        <ConfirmStep
          kind={shown}
          name={project.name}
          warning={
            shown === "done" ? CLOSE_COPY.openWorkWarning(openWork(milestones, contributed)) : null
          }
          wasDone={project.status === "done"}
          error={error}
          pending={pending}
          backRef={backKey}
          onDismiss={dismiss}
          onConfirm={confirm}
        />
      ) : closed ? (
        <Key ref={reopenKey} icon={RotateCcw} className="w-fit" onClick={() => open("reopen")}>
          {CLOSE_COPY.reopen}
        </Key>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Key ref={doneKey} icon={CircleCheck} onClick={() => open("done")}>
            {CLOSE_COPY.markDone}
          </Key>
          <Key ref={cancelKey} variant="ghost" icon={Ban} onClick={() => open("canceled")}>
            {CLOSE_COPY.cancelProject}
          </Key>
        </div>
      )}
    </section>
  );
}

type ConfirmStepProps = {
  kind: Step;
  name: string;
  /** Done only: what is still open ("Quedan 2 hitos abiertos. ¿Terminar igual?"), or null. */
  warning: string | null;
  /** Reopen only: a done project loses its finish date. */
  wasDone: boolean;
  error: string | null;
  pending: boolean;
  backRef: React.RefObject<HTMLButtonElement | null>;
  onDismiss: () => void;
  onConfirm: () => void;
};

const STEP_COPY = {
  done: {
    title: CLOSE_COPY.doneTitle,
    confirm: CLOSE_COPY.doneConfirm,
    pending: CLOSE_COPY.finishing,
    icon: CircleCheck,
  },
  canceled: {
    title: CLOSE_COPY.cancelTitle,
    confirm: CLOSE_COPY.cancelConfirm,
    pending: CLOSE_COPY.canceling,
    icon: Ban,
  },
  reopen: {
    title: CLOSE_COPY.reopenTitle,
    confirm: CLOSE_COPY.reopenConfirm,
    pending: CLOSE_COPY.reopening,
    icon: RotateCcw,
  },
} as const;

/**
 * The confirm step on the page (`role="group"` named by the question; the warning and the
 * explanation are its description). Focus starts on "Volver"; Esc or "Volver" go back.
 */
export function ConfirmStep({
  kind,
  name,
  warning,
  wasDone,
  error,
  pending,
  backRef,
  onDismiss,
  onConfirm,
}: ConfirmStepProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const warningId = `${ids}-warning`;
  const textId = `${ids}-text`;
  const copy = STEP_COPY[kind];
  const text =
    kind === "done"
      ? CLOSE_COPY.doneText
      : kind === "canceled"
        ? CLOSE_COPY.cancelText
        : wasDone
          ? CLOSE_COPY.reopenDoneText
          : CLOSE_COPY.reopenText;
  const disabled = {
    "aria-disabled": pending || undefined,
    className: cn(pending && "is-disabled"),
  };
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={warning ? `${warningId} ${textId}` : textId}
      className="bo-card max-w-160 gap-4"
      data-close-step={kind}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
    >
      <p id={titleId} className="bo-text-body-strong break-words">
        {copy.title(name)}
      </p>
      {warning ? (
        <p
          id={warningId}
          className="bo-text-body-sm flex items-start gap-2 text-signal-text"
          data-open-work-warning
        >
          <Icon icon={TriangleAlert} size="sm" className="mt-0.5 shrink-0" />
          <span>{warning}</span>
        </p>
      ) : null}
      <p id={textId} className="bo-text-body-sm text-text-secondary">
        {text}
      </p>
      {error ? (
        <p role="alert" className="bo-field__error">
          <Icon icon={TriangleAlert} size="sm" />
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Key ref={backRef} variant="ghost" {...disabled} onClick={onDismiss}>
          {CLOSE_COPY.back}
        </Key>
        <Key variant="signal" icon={copy.icon} {...disabled} onClick={onConfirm}>
          {pending ? copy.pending : copy.confirm}
        </Key>
      </div>
      {/* The key's text changes too, but a screen reader on "Volver" wouldn't hear it. */}
      <p role="status" className="sr-only">
        {pending ? copy.pending : ""}
      </p>
    </div>
  );
}
