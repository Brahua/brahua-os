"use client";

import { Pencil } from "lucide-react";
import { startTransition, useEffect, useId, useOptimistic, useRef, useState } from "react";
import { Key, SectionLabel } from "@/design-system";
import { useUnsavedChangesGuard } from "@/lib/navigation-guard";
import {
  ClientMarkdown,
  loadMarkdown,
  NotesEditor,
  NotesLeaveConfirm,
  type NotesTab,
} from "@/modules/projects/components/notes-editor";
import { NOTES_COPY, NOTES_COUNTER_FROM } from "@/modules/projects/notes-links-copy";
import { updateProjectNotes } from "@/modules/projects/notes-actions";
import {
  PROJECT_NOTES_MAX_LENGTH,
  updateProjectNotesInputSchema,
} from "@/modules/projects/project-notes-input";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";
import { useInlineEditor } from "./inline-editor";
import { useProjectDetail } from "./project-detail-context";

/** Headings in notes start at h3: the section's title is an h2. */
const HEADING_OFFSET = 2;

type ProjectNotesSectionProps = {
  /** The saved notes rendered on the server (`<Markdown>`), or null without notes. */
  rendered: React.ReactNode;
};

/**
 * "Notas" (SPEC-projects): Markdown shown rendered, edited with "Escribir" / "Vista previa"
 * tabs and saved explicitly. While there are unsaved changes, leaving the page asks first
 * (src/lib/navigation-guard.ts). Saving is optimistic: the editor closes and the new notes show
 * at once; a failure puts the old ones back with a notice and keeps the text for another try.
 */
export function ProjectNotesSection({ rendered }: ProjectNotesSectionProps) {
  const { project, enqueue, toaster, announce } = useProjectDetail();
  const [notes, setOptimisticNotes] = useOptimistic(project.notes);
  const trigger = useRef<HTMLButtonElement>(null);
  const editor = useInlineEditor(trigger);
  /** Unsaved text: while editing, or kept after a failed save. Null when there is none. */
  const [draft, setDraft] = useState<string | null>(null);
  const [tab, setTab] = useState<NotesTab>("write");
  const [error, setError] = useState<string | undefined>();
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stayKey = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const headingId = `${ids}-heading`;

  const dirty = draft !== null && draft !== (project.notes ?? "");
  useUnsavedChangesGuard(dirty, (proceed) => setLeaving(() => proceed));

  useEffect(() => {
    if (!leaving) return;
    stayKey.current?.scrollIntoView?.({ block: "center" });
    stayKey.current?.focus();
  }, [leaving]);

  function open() {
    void loadMarkdown();
    setDraft((current) => current ?? project.notes ?? "");
    setTab("write");
    setError(undefined);
    editor.open();
  }

  function cancel() {
    setDraft(null);
    setError(undefined);
    setLeaving(null);
    editor.close();
  }

  function stay() {
    setLeaving(null);
    // The draft may be waiting with the editor closed (after a failed save): open it, so
    // "Seguir editando" lands where the text is.
    if (editor.editing) setTab("write");
    else open();
    // After the confirmation unmounts (and the editor mounts); never leave focus on <body>.
    window.setTimeout(() => (textarea.current ?? trigger.current)?.focus(), 0);
  }

  function leave() {
    const proceed = leaving;
    setLeaving(null);
    setDraft(null);
    proceed?.();
  }

  function save() {
    const text = draft ?? "";
    const parsed = updateProjectNotesInputSchema.safeParse({ id: project.id, notes: text });
    if (!parsed.success) {
      setError(parsed.error.issues.find((issue) => issue.path[0] === "notes")?.message);
      setTab("write");
      window.setTimeout(() => textarea.current?.focus(), 0);
      return;
    }
    setDraft(null);
    setLeaving(null);
    editor.close();
    const saved = parsed.data.notes;
    if (saved === project.notes) return;
    startTransition(async () => {
      setOptimisticNotes(saved);
      const queued = await enqueue(`notes:${project.id}`, () => updateProjectNotes(parsed.data));
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        announce(saved === null ? NOTES_COPY.savedEmpty : NOTES_COPY.saved);
        return;
      }
      // A throw is a network failure or a new deployment: the action itself never throws.
      const reason =
        queued.kind === "threw"
          ? PROJECTS_COPY.checkConnection
          : queued.value.ok
            ? ""
            : (queued.value.fieldErrors?.notes?.[0] ?? queued.value.error);
      // Nothing is lost: the text waits in the editor (unless a newer draft was started).
      setDraft((current) => current ?? text);
      toaster.push({
        title: NOTES_COPY.notSavedTitle,
        text: `${NOTES_COPY.notSaved} ${reason} ${NOTES_COPY.draftKept}`,
        tone: "error",
      });
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionLabel id={headingId} as="h2" title={NOTES_COPY.section} />
      {leaving ? <NotesLeaveConfirm stayKey={stayKey} onStay={stay} onLeave={leave} /> : null}
      <div className="bo-card gap-4">
        {editor.editing ? (
          <NotesEditor
            draft={draft ?? ""}
            tab={tab}
            error={error}
            textarea={textarea}
            headingOffset={HEADING_OFFSET}
            maxLength={PROJECT_NOTES_MAX_LENGTH}
            counterFrom={NOTES_COUNTER_FROM}
            onTab={setTab}
            onChange={(value) => {
              setDraft(value);
              setError(undefined);
            }}
            onSave={save}
            onCancel={cancel}
          />
        ) : (
          <>
            {notes === null ? (
              <p className="bo-text-body-sm text-text-secondary">{NOTES_COPY.empty}</p>
            ) : notes === project.notes && rendered ? (
              rendered
            ) : (
              <ClientMarkdown headingOffset={HEADING_OFFSET}>{notes}</ClientMarkdown>
            )}
            {dirty ? (
              <p className="bo-text-body-sm text-text-secondary">{NOTES_COPY.draftPending}</p>
            ) : null}
            <Key ref={trigger} variant="ghost" icon={Pencil} className="w-fit" onClick={open}>
              {notes === null && !dirty ? NOTES_COPY.write : NOTES_COPY.edit}
            </Key>
          </>
        )}
      </div>
    </section>
  );
}
