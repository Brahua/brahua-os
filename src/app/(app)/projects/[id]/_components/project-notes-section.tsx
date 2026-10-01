"use client";

import { Pencil, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import { startTransition, useEffect, useId, useOptimistic, useRef, useState } from "react";
import { Icon, Key, SectionLabel, TextArea } from "@/design-system";
import { useUnsavedChangesGuard } from "@/lib/navigation-guard";
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

const loadMarkdown = () => import("@/lib/markdown/markdown").then((module) => module.Markdown);

/**
 * The renderer on the client, only for the live preview and for notes just saved (until the
 * page's server-rendered version arrives). Loaded on demand: the page itself ships no Markdown
 * code (its notes are rendered on the server).
 */
const ClientMarkdown = dynamic(loadMarkdown, {
  ssr: false,
  loading: () => <p className="bo-text-body-sm text-text-secondary">{NOTES_COPY.previewLoading}</p>,
});

type Tab = "write" | "preview";

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
  const [tab, setTab] = useState<Tab>("write");
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
    setTab("write");
    // After the confirmation unmounts.
    window.setTimeout(() => textarea.current?.focus(), 0);
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
      {leaving ? <LeaveConfirm stayKey={stayKey} onStay={stay} onLeave={leave} /> : null}
      <div className="bo-card gap-4">
        {editor.editing ? (
          <NotesEditor
            draft={draft ?? ""}
            tab={tab}
            error={error}
            textarea={textarea}
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

function LeaveConfirm({
  stayKey,
  onStay,
  onLeave,
}: {
  stayKey: React.Ref<HTMLButtonElement>;
  onStay: () => void;
  onLeave: () => void;
}) {
  const ids = useId();
  return (
    <div
      role="group"
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-text`}
      data-notes-leave
      className="bo-card gap-4"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onStay();
      }}
    >
      <p id={`${ids}-title`} className="bo-text-body-strong flex items-center gap-2">
        <Icon icon={TriangleAlert} size="sm" />
        {NOTES_COPY.leaveTitle}
      </p>
      <p id={`${ids}-text`} className="bo-text-body-sm text-text-secondary">
        {NOTES_COPY.leaveText}
      </p>
      <div className="flex flex-wrap gap-2">
        <Key ref={stayKey} variant="signal" onClick={onStay}>
          {NOTES_COPY.stay}
        </Key>
        <Key variant="ghost" onClick={onLeave}>
          {NOTES_COPY.leave}
        </Key>
      </div>
    </div>
  );
}

const TABS: { value: Tab; label: string }[] = [
  { value: "write", label: NOTES_COPY.tabWrite },
  { value: "preview", label: NOTES_COPY.tabPreview },
];

function NotesEditor({
  draft,
  tab,
  error,
  textarea,
  onTab,
  onChange,
  onSave,
  onCancel,
}: {
  draft: string;
  tab: Tab;
  error: string | undefined;
  textarea: React.RefObject<HTMLTextAreaElement | null>;
  onTab: (tab: Tab) => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabId = (value: Tab) => `${ids}-tab-${value}`;
  const panelId = (value: Tab) => `${ids}-panel-${value}`;
  const used = draft.length;
  const help =
    used > PROJECT_NOTES_MAX_LENGTH
      ? NOTES_COPY.overLimit(used)
      : used >= NOTES_COUNTER_FROM
        ? NOTES_COPY.counter(used)
        : NOTES_COPY.help;

  // Automatic activation (WAI-ARIA tabs): arrows, Home and End move and select.
  function onTabKeyDown(event: React.KeyboardEvent, index: number) {
    const last = TABS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    tabRefs.current[next]?.focus();
    onTab(TABS[next].value);
  }

  return (
    <form
      noValidate
      aria-label={NOTES_COPY.editorLabel}
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div role="tablist" aria-label={NOTES_COPY.tabsLabel} className="bo-segmented self-start">
        {TABS.map((item, index) => {
          const selected = item.value === tab;
          return (
            <button
              key={item.value}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={tabId(item.value)}
              aria-selected={selected}
              aria-controls={panelId(item.value)}
              tabIndex={selected ? 0 : -1}
              className="bo-segmented__item"
              onClick={() => onTab(item.value)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {/* The textarea stays mounted while previewing: its undo history survives. */}
      <div
        role="tabpanel"
        id={panelId("write")}
        aria-labelledby={tabId("write")}
        hidden={tab !== "write"}
      >
        <TextArea
          ref={textarea}
          label={NOTES_COPY.textLabel}
          value={draft}
          rows={12}
          autoFocus
          spellCheck
          error={error}
          help={help}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </div>
      <div
        role="tabpanel"
        id={panelId("preview")}
        aria-labelledby={tabId("preview")}
        hidden={tab !== "preview"}
        // Focusable: the preview has no controls of its own to land on.
        tabIndex={0}
        className="min-h-24 rounded-lg p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {tab === "preview" ? (
          draft.trim() ? (
            <ClientMarkdown headingOffset={HEADING_OFFSET}>{draft}</ClientMarkdown>
          ) : (
            <p className="bo-text-body-sm text-text-secondary">{NOTES_COPY.previewEmpty}</p>
          )
        ) : null}
      </div>
      <p role="status" className="sr-only">
        {error ?? ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Key type="submit" variant="signal">
          {NOTES_COPY.save}
        </Key>
        <Key variant="ghost" onClick={onCancel}>
          {NOTES_COPY.cancel}
        </Key>
      </div>
    </form>
  );
}
