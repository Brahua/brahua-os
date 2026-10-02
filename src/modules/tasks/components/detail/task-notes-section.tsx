"use client";

import { Pencil } from "lucide-react";
import {
  createContext,
  startTransition,
  use,
  useEffect,
  useId,
  useMemo,
  useOptimistic,
  useRef,
  useState,
} from "react";
import { Key, SectionLabel } from "@/design-system";
import { useUnsavedChangesGuard } from "@/lib/navigation-guard";
import {
  ClientMarkdown,
  loadMarkdown,
  NotesEditor,
  NotesLeaveConfirm,
  type NotesTab,
} from "@/modules/projects/components/notes-editor";
import { readTaskNotes, updateTaskNotes } from "../../detail-actions";
import {
  TASK_NOTES_COUNTER_FROM,
  TASK_NOTES_MAX_LENGTH,
  updateTaskNotesInputSchema,
} from "../../detail-input";
import { TASKS_COPY } from "../../tasks-copy";
import { VIEWS_COPY } from "../../views-copy";
import { useDetailCloseGuard } from "./detail-close-guard";
import { useTaskDetail } from "./task-detail-context";

/** The notes the task's page read and rendered on the server (`<Markdown>`). */
type NotesSeed = { notes: string | null; rendered: React.ReactNode };

const NotesSeedContext = createContext<NotesSeed | null>(null);

/**
 * On the task's page, the notes come from the server already rendered (no Markdown code on the
 * page until the editor opens). The sheet has no seed: it reads them when it opens.
 */
export function TaskNotesSeed({
  notes,
  rendered,
  children,
}: NotesSeed & { children: React.ReactNode }) {
  // Stable between renders: a new object only when the server sends new notes.
  const value = useMemo(() => ({ notes, rendered }), [notes, rendered]);
  return <NotesSeedContext value={value}>{children}</NotesSeedContext>;
}

/** Loaded notes (null: none); `undefined` while loading, `false` when loading failed. */
type Loaded = string | null | undefined | false;

/**
 * "Notas" of a task (SPEC-tasks; the pattern of the project's notes, P5): Markdown shown
 * rendered, edited with "Escribir" / "Vista previa" and saved explicitly. While there are unsaved
 * changes, leaving the page or closing the sheet asks first. Saving is optimistic: the editor
 * closes and the new notes show at once; a failure puts the old ones back, says why
 * (`reportError`) and keeps the text as a draft.
 */
export function TaskNotesSection() {
  const { task, host, enqueue, announce, reportError } = useTaskDetail();
  const seed = use(NotesSeedContext);
  const [loaded, setLoaded] = useState<Loaded>(seed ? seed.notes : undefined);
  // A newer seed (the page revalidated): it becomes the base.
  const [seedSource, setSeedSource] = useState(seed);
  if (seed !== seedSource) {
    setSeedSource(seed);
    if (seed) setLoaded(seed.notes);
  }
  const base = typeof loaded === "string" ? loaded : null;
  const [notes, setOptimisticNotes] = useOptimistic(base);
  const trigger = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const refocus = useRef(false);
  /** Unsaved text: while editing, or kept after a failed save. Null when there is none. */
  const [draft, setDraft] = useState<string | null>(null);
  const [tab, setTab] = useState<NotesTab>("write");
  const [error, setError] = useState<string | undefined>();
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stayKey = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const headingId = `${ids}-heading`;
  const inSheet = host === "sheet";
  // `#` in the notes is one level under the section's heading (h3 on the page, h4 in the sheet).
  const headingOffset = inSheet ? 3 : 2;

  // The sheet reads the notes when it opens (the lists never carry them).
  useEffect(() => {
    if (seed) return;
    let current = true;
    readTaskNotes({ id: task.id }).then(
      (result) => {
        if (current) setLoaded(result.ok ? result.data.notes : false);
      },
      () => {
        if (current) setLoaded(false);
      },
    );
    return () => {
      current = false;
    };
  }, [seed, task.id]);

  // The pencil key unmounts while editing: closing puts focus back on it explicitly.
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    trigger.current?.focus();
  }, [editing]);

  const dirty = draft !== null && draft !== (base ?? "");
  useUnsavedChangesGuard(dirty, (proceed) => setLeaving(() => proceed));
  useDetailCloseGuard(dirty, (proceed) => setLeaving(() => proceed));

  useEffect(() => {
    if (!leaving) return;
    stayKey.current?.scrollIntoView?.({ block: "center" });
    stayKey.current?.focus();
  }, [leaving]);

  function open() {
    void loadMarkdown();
    setDraft((current) => current ?? base ?? "");
    setTab("write");
    setError(undefined);
    setEditing(true);
  }

  function close() {
    refocus.current = true;
    setEditing(false);
  }

  function cancel() {
    setDraft(null);
    setError(undefined);
    setLeaving(null);
    close();
  }

  function stay() {
    setLeaving(null);
    if (editing) setTab("write");
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
    const parsed = updateTaskNotesInputSchema.safeParse({ id: task.id, notes: text });
    if (!parsed.success) {
      setError(parsed.error.issues.find((issue) => issue.path[0] === "notes")?.message);
      setTab("write");
      window.setTimeout(() => textarea.current?.focus(), 0);
      return;
    }
    setDraft(null);
    setLeaving(null);
    close();
    const saved = parsed.data.notes;
    if (saved === base) return;
    startTransition(async () => {
      setOptimisticNotes(saved);
      const queued = await enqueue(`task-notes:${task.id}`, () => updateTaskNotes(parsed.data));
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        setLoaded(queued.value.data.notes);
        announce(saved === null ? VIEWS_COPY.notesSavedEmpty : VIEWS_COPY.notesSaved);
        return;
      }
      // A throw is a network failure or a new deployment: the action itself never throws.
      const reason =
        queued.kind === "threw"
          ? TASKS_COPY.checkConnection
          : queued.value.ok
            ? ""
            : (queued.value.fieldErrors?.notes?.[0] ?? queued.value.error);
      // Nothing is lost: the text waits in the editor (unless a newer draft was started).
      setDraft((current) => current ?? text);
      reportError(`${VIEWS_COPY.notesNotSaved} ${reason} ${VIEWS_COPY.notesDraftKept}`);
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" data-task-notes="">
      <SectionLabel id={headingId} as={inSheet ? "h3" : "h2"} title={VIEWS_COPY.notesSection} />
      {leaving ? <NotesLeaveConfirm stayKey={stayKey} onStay={stay} onLeave={leave} /> : null}
      <div className="bo-card gap-4">
        {loaded === undefined ? (
          <p className="bo-text-body-sm text-text-secondary">{VIEWS_COPY.notesLoading}</p>
        ) : loaded === false ? (
          <p className="bo-text-body-sm text-text-secondary">{VIEWS_COPY.notesLoadFailed}</p>
        ) : editing ? (
          <NotesEditor
            draft={draft ?? ""}
            tab={tab}
            error={error}
            textarea={textarea}
            headingOffset={headingOffset}
            maxLength={TASK_NOTES_MAX_LENGTH}
            counterFrom={TASK_NOTES_COUNTER_FROM}
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
              <p className="bo-text-body-sm text-text-secondary">{VIEWS_COPY.notesEmpty}</p>
            ) : seed && notes === seed.notes && seed.rendered ? (
              seed.rendered
            ) : (
              <ClientMarkdown headingOffset={headingOffset}>{notes}</ClientMarkdown>
            )}
            {dirty ? (
              <p className="bo-text-body-sm text-text-secondary">{VIEWS_COPY.notesDraftPending}</p>
            ) : null}
            <Key ref={trigger} variant="ghost" icon={Pencil} className="w-fit" onClick={open}>
              {notes === null && !dirty ? VIEWS_COPY.notesWrite : VIEWS_COPY.notesEdit}
            </Key>
          </>
        )}
      </div>
    </section>
  );
}
