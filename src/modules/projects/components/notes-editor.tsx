"use client";

// The notes editor shared by projects (P5) and tasks (T2): "Escribir" / "Vista previa" tabs
// (WAI-ARIA, automatic activation), the character counter, explicit "Guardar" (or ⌘↵ / Ctrl+↵)
// and "Cancelar", plus the in-page confirmation shown when leaving with unsaved changes.
import { TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import { useId, useRef } from "react";
import { Icon, Key, TextArea } from "@/design-system";
import type { MarkdownProps } from "@/lib/markdown/markdown";
import { NOTES_COPY, NOTES_COUNTER_FROM } from "@/modules/projects/notes-links-copy";
import { PROJECT_NOTES_MAX_LENGTH } from "@/modules/projects/project-notes-input";

export const loadMarkdown = () =>
  import("@/lib/markdown/markdown").then((module) => module.Markdown);

/**
 * The renderer on the client, only for the live preview and for notes just saved (until the
 * page's server-rendered version arrives). Loaded on demand: a page ships no Markdown code of
 * its own (its notes are rendered on the server).
 */
export const ClientMarkdown = dynamic(loadMarkdown, {
  ssr: false,
  loading: () => <p className="bo-text-body-sm text-text-secondary">{NOTES_COPY.previewLoading}</p>,
});

export type NotesTab = "write" | "preview";

export function NotesLeaveConfirm({
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

const TABS: { value: NotesTab; label: string }[] = [
  { value: "write", label: NOTES_COPY.tabWrite },
  { value: "preview", label: NOTES_COPY.tabPreview },
];

export function NotesEditor({
  draft,
  tab,
  error,
  textarea,
  headingOffset,
  onTab,
  onChange,
  onSave,
  onCancel,
}: {
  draft: string;
  tab: NotesTab;
  error: string | undefined;
  textarea: React.RefObject<HTMLTextAreaElement | null>;
  /** Headings in the preview start this many levels down (under the section's heading). */
  headingOffset: NonNullable<MarkdownProps["headingOffset"]>;
  onTab: (tab: NotesTab) => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabId = (value: NotesTab) => `${ids}-tab-${value}`;
  const panelId = (value: NotesTab) => `${ids}-panel-${value}`;
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
            <ClientMarkdown headingOffset={headingOffset}>{draft}</ClientMarkdown>
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
