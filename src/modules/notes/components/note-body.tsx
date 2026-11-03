"use client";

import { Check, Pencil, RotateCw, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon, Key, TextArea } from "@/design-system";
import { normalizeNotes } from "@/lib/markdown-text";
import { useUnsavedChangesGuard } from "@/lib/navigation-guard";
import { isShortcutFreeTarget } from "@/lib/shortcuts";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { deleteNote } from "../actions";
import { NOTES_COPY as COPY } from "../copy";
import { NOTE_BODY_COUNTER_FROM, NOTE_BODY_MAX_LENGTH } from "../note-constants";
import { DELETED_PARAM, NOTES_PATH } from "../routes";
import type { NoteLinkResolutions } from "@/lib/markdown/note-links";
import { pendingDayLink } from "./day-focus";
import { useLinkPicker, type SearchLinks } from "./link-picker";
import { ClientMarkdown, loadMarkdown } from "./note-markdown";
import { SaveIndicator } from "./save-indicator";
import { differsFrom, failureReason, useNoteAutosave, type KnownNote } from "./use-note-autosave";

/** Headings in a note start at h2: the note's title (or date) is the page's h1. */
const HEADING_OFFSET = 1;

type NoteBodyProps = {
  /** The note as the page read it (`id` null: a day without a note yet, `version` then 0). */
  note: KnownNote;
  /** A daily note's day; null for a knowledge note. */
  day: string | null;
  /** The saved body rendered on the server (`<Markdown>`), or null when it is empty. */
  rendered: React.ReactNode;
  /** Single-key shortcuts on (the `E` key opens the editor). */
  shortcuts: boolean;
  /** N2: «Enlazada desde» (the notes that link here) goes in this slot, under the body. */
  linkedFrom?: React.ReactNode;
  /**
   * N2: what the server resolved for the body's `[[…]]` links, so a text rendered on the client
   * (just typed) still shows current names. Links it doesn't know show their saved name.
   */
  noteLinks?: NoteLinkResolutions;
  /** N2: the `[[` picker's search (a read-only Server Action). Without it, no picker. */
  searchLinks?: SearchLinks;
  /** N3: the daily note's «Ese día» footer goes in this slot, last. */
  dayFooter?: React.ReactNode;
};

/**
 * A note's body (SPEC-notes "Edición y lectura"): shown rendered; «Editar», the `E` key or a tap
 * on the text turn it into a `textarea`, and «Listo» or Esc go back to the view (what was typed is
 * already saving: Esc saves what is pending first). An empty note opens straight in the editor,
 * with the cursor in it (unless a day link brought the owner here: the focus stays on that link).
 * Saving is automatic (`useNoteAutosave`); while something is unsaved, leaving asks first.
 */
export function NoteBody({
  note,
  day,
  rendered,
  shortcuts,
  linkedFrom = null,
  dayFooter = null,
  noteLinks,
  searchLinks,
}: NoteBodyProps) {
  const router = useRouter();
  const { toaster, announce } = useRequiredScreenServices();
  const autosave = useNoteAutosave({ initial: note, day, announce });
  const { text, setText, flush, status, conflict, draft, dirty } = autosave;
  // From what the server answered: a day's first save (or its conflict) gives the note an id.
  const noteId = autosave.known.id ?? conflict?.id ?? null;
  const [editing, setEditing] = useState(note.body === "");
  // Read once, during the first render (before the day header takes the pending link).
  const [focusOnMount] = useState(() => note.body === "" && pendingDayLink() === null);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [deleting, setDeleting] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const editKey = useRef<HTMLButtonElement>(null);
  const stayKey = useRef<HTMLButtonElement>(null);
  const conflictHeading = useRef<HTMLParagraphElement>(null);
  const retryPressed = useRef(false);
  const ids = useId();

  // The `[[` picker: choosing replaces `[[texto` with the link (the autosave runs as with any key)
  // and the cursor goes right after it. Through `insertText` when the browser has it, so ⌘Z undoes
  // the insertion natively (its input event reaches onChange); otherwise the text is set, and the
  // cursor placed once React has put it in the field.
  const pendingCaret = useRef<number | null>(null);
  const picker = useLinkPicker({
    text,
    search: searchLinks,
    announce,
    idPrefix: ids,
    onChoose: ({ text: next, caret, name, link, start, end }) => {
      const field = textarea.current;
      let inserted = false;
      if (field && typeof document.execCommand === "function") {
        field.setSelectionRange(start, end);
        try {
          inserted = document.execCommand("insertText", false, link) && field.value === next;
        } catch {
          inserted = false;
        }
      }
      pendingCaret.current = caret;
      if (!inserted) setText(next);
      announce(COPY.linkInserted(name));
    },
  });
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null || !textarea.current) return;
    pendingCaret.current = null;
    textarea.current.setSelectionRange(caret, caret);
  });

  // Element to focus after the next render (the editor opened or closed).
  const pendingFocus = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const find = pendingFocus.current;
    if (!find) return;
    pendingFocus.current = null;
    const element = find();
    element?.focus();
    if (element instanceof HTMLTextAreaElement) {
      const end = element.value.length;
      element.setSelectionRange(end, end);
    }
  });

  // An empty note reached on purpose («Nota de hoy», `N`, «Crear nota», a day): the cursor is in
  // the text (SPEC-notes, story 1).
  useEffect(() => {
    if (focusOnMount) textarea.current?.focus();
  }, [focusOnMount]);

  useUnsavedChangesGuard(dirty, (proceed) => {
    flush();
    setLeaving(() => proceed);
  });

  // The pending save landed while the question was on screen: nothing is lost, so go on.
  // (The navigation unmounts this screen, question included.)
  useEffect(() => {
    if (leaving && !dirty) leaving();
  }, [leaving, dirty]);

  useEffect(() => {
    if (!leaving) return;
    stayKey.current?.scrollIntoView?.({ block: "center" });
    stayKey.current?.focus();
  }, [leaving]);

  // A conflict never takes the focus from the text being typed: it is announced there. From
  // anywhere else, the notice takes it (the owner must decide before saving again).
  useEffect(() => {
    if (!conflict) return;
    if (textarea.current && document.activeElement === textarea.current) {
      announce(`${COPY.conflictTitle}. ${COPY.conflictText}`);
      return;
    }
    conflictHeading.current?.focus();
  }, [conflict, announce]);

  // «Reintentar» leaves once the save is on its way: its focus goes back to the text (or «Editar»).
  useEffect(() => {
    if (status.kind === "failed" || !retryPressed.current) return;
    retryPressed.current = false;
    (textarea.current ?? editKey.current)?.focus();
  }, [status.kind]);

  function openEditor() {
    void loadMarkdown();
    setEditing(true);
    pendingFocus.current = () => textarea.current;
  }

  function closeEditor() {
    autosave.announceWhenSaved();
    setEditing(false);
    pendingFocus.current = () => editKey.current;
  }

  // `E` opens the editor (the same rules as the app's keys: never while typing, in a widget or a
  // dialog, nor with modifiers). A layout effect: a key pressed right after a render isn't lost.
  useLayoutEffect(() => {
    if (!shortcuts || editing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "e" && event.key !== "E") return;
      if (isShortcutFreeTarget(event.target)) return;
      event.preventDefault();
      // openEditor(), inlined: only state setters and refs, so the listener needs no other deps.
      void loadMarkdown();
      setEditing(true);
      pendingFocus.current = () => textarea.current;
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, editing]);

  async function remove() {
    if (deleting || noteId === null) return;
    setDeleting(true);
    // First what is pending lands (the last second of text is never lost), then the delete; the
    // autosave stops only once the note is really gone.
    await autosave.settle();
    const id = autosave.currentId() ?? noteId;
    let result;
    try {
      result = await deleteNote({ id });
    } catch {
      result = null;
    }
    if (!result || !result.ok) {
      setDeleting(false);
      toaster.push({
        title: COPY.notSavedTitle,
        text: `${COPY.notSaved.delete} ${result ? failureReason(result) : COPY.checkConnection}`,
        tone: "error",
      });
      return;
    }
    autosave.stop();
    router.push(`${NOTES_PATH}?${DELETED_PARAM}=${id}`);
  }

  const used = normalizeNotes(text).length;
  const over = used > NOTE_BODY_MAX_LENGTH;
  // The counter joins the help (never replaces it).
  const baseHelp = searchLinks ? `${COPY.bodyHelp} ${COPY.bodyHelpLinks}` : COPY.bodyHelp;
  const help =
    used >= NOTE_BODY_COUNTER_FROM && !over
      ? `${baseHelp} ${COPY.counter(used, NOTE_BODY_MAX_LENGTH)}`
      : baseHelp;
  const showServerRender = rendered !== null && !differsFrom(text, note.body);

  return (
    <div
      className="flex flex-col gap-6"
      data-note-body=""
      data-saving={status.kind === "saving" || undefined}
    >
      <div
        role="group"
        aria-label={COPY.actionsLabel}
        className="flex flex-wrap items-center gap-2"
      >
        {editing ? (
          <Key variant="signal" icon={Check} data-note-done="" onClick={closeEditor}>
            {COPY.done}
          </Key>
        ) : (
          <Key
            ref={editKey}
            variant="default"
            icon={Pencil}
            shortcut={shortcuts ? "E" : undefined}
            aria-keyshortcuts={shortcuts ? "E" : undefined}
            data-note-edit=""
            onClick={openEditor}
          >
            {COPY.edit}
          </Key>
        )}
        {noteId !== null ? (
          <Key
            variant="ghost"
            icon={Trash2}
            aria-disabled={deleting || undefined}
            data-note-delete=""
            onClick={() => void remove()}
          >
            {COPY.delete}
          </Key>
        ) : null}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <SaveIndicator status={status} />
          {status.kind === "failed" ? (
            <Key
              variant="ghost"
              size="sm"
              icon={RotateCw}
              data-note-retry=""
              onClick={() => {
                retryPressed.current = true;
                flush();
              }}
            >
              {COPY.retry}
            </Key>
          ) : null}
        </div>
      </div>

      {leaving ? (
        <div
          role="group"
          aria-labelledby={`${ids}-leave-title`}
          aria-describedby={`${ids}-leave-text`}
          className="bo-card gap-4"
          data-note-leave=""
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setLeaving(null);
            pendingFocus.current = () => textarea.current ?? editKey.current;
          }}
        >
          <p id={`${ids}-leave-title`} className="bo-text-body-strong flex items-center gap-2">
            <Icon icon={TriangleAlert} size="sm" />
            {COPY.leaveTitle}
          </p>
          <p id={`${ids}-leave-text`} className="bo-text-body-sm text-text-secondary">
            {COPY.leaveText}
          </p>
          <div className="flex flex-wrap gap-2">
            <Key
              ref={stayKey}
              variant="signal"
              onClick={() => {
                setLeaving(null);
                if (!editing) setEditing(true);
                pendingFocus.current = () => textarea.current;
              }}
            >
              {COPY.stay}
            </Key>
            <Key
              variant="ghost"
              onClick={() => {
                const proceed = leaving;
                autosave.stop();
                setLeaving(null);
                proceed();
              }}
            >
              {COPY.leave}
            </Key>
          </div>
        </div>
      ) : null}

      {conflict ? (
        <div
          role="group"
          aria-labelledby={`${ids}-conflict-title`}
          aria-describedby={`${ids}-conflict-text`}
          className="bo-card gap-3"
          data-note-conflict=""
        >
          <p
            ref={conflictHeading}
            id={`${ids}-conflict-title`}
            tabIndex={-1}
            className="bo-text-body-strong flex items-center gap-2 rounded-md outline-none focus:outline-2 focus:outline-offset-2 focus:outline-focus"
          >
            <Icon icon={TriangleAlert} size="sm" />
            {COPY.conflictTitle}
          </p>
          <p id={`${ids}-conflict-text`} className="bo-text-body-sm text-text-secondary">
            {COPY.conflictText}
          </p>
          <div className="flex flex-wrap gap-2">
            <Key
              variant="signal"
              data-note-keep-mine=""
              onClick={() => {
                autosave.keepMine();
                pendingFocus.current = () => textarea.current ?? editKey.current;
              }}
            >
              {COPY.keepMine}
            </Key>
            <Key
              variant="ghost"
              data-note-view-saved=""
              onClick={() => {
                autosave.viewSaved();
                setEditing(false);
                pendingFocus.current = () => editKey.current;
              }}
            >
              {COPY.viewSaved}
            </Key>
          </div>
        </div>
      ) : null}

      {editing ? (
        <form
          noValidate
          aria-label={COPY.editorLabel}
          className="flex min-w-0 flex-col gap-2"
          onSubmit={(event) => event.preventDefault()}
        >
          <TextArea
            ref={textarea}
            label={COPY.bodyLabel}
            value={text}
            rows={16}
            spellCheck
            help={help}
            error={over ? COPY.overLimit(used, NOTE_BODY_MAX_LENGTH) : undefined}
            data-note-textarea=""
            {...picker.fieldProps}
            onChange={(event) => {
              setText(event.target.value);
              picker.track(event);
            }}
            // After a failure, leaving the field doesn't try again by itself (pressing «Reintentar»
            // blurs the field first: the key must still be there to take the click).
            onBlur={() => {
              picker.fieldProps.onBlur();
              if (status.kind !== "failed") flush();
            }}
            onKeyDown={(event) => {
              // The picker's own keys first (its Esc closes the list, never the editor).
              if (picker.onKeyDown(event)) return;
              if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.stopPropagation();
              closeEditor();
            }}
          />
          {picker.list}
        </form>
      ) : (
        <div
          className="min-w-0 cursor-text"
          data-note-view=""
          // A tap on the text opens the editor; a link inside still opens, and selecting text
          // (to copy it) doesn't. Keyboard users have «Editar» and `E`.
          onClick={(event) => {
            if ((event.target as Element).closest("a, button, summary, [role='group']")) return;
            if (window.getSelection()?.toString()) return;
            openEditor();
          }}
        >
          {normalizeNotes(text) === "" ? (
            <p className="bo-text-body-sm text-text-secondary">{COPY.emptyBody}</p>
          ) : showServerRender ? (
            rendered
          ) : (
            // The typed text may hold links the server never looked up (just inserted): those
            // show their saved name, never «(ya no existe)».
            <ClientMarkdown
              headingOffset={HEADING_OFFSET}
              noteLinks={noteLinks}
              unknownNoteLinks="saved"
            >
              {text}
            </ClientMarkdown>
          )}
        </div>
      )}

      {draft !== null ? (
        <section
          aria-labelledby={`${ids}-draft-title`}
          className="bo-card gap-3"
          data-note-draft=""
        >
          <h2 id={`${ids}-draft-title`} className="bo-text-body-strong">
            {COPY.draftTitle}
          </h2>
          <p className="bo-text-body-sm text-text-secondary">{COPY.draftText}</p>
          <TextArea label={COPY.draftLabel} value={draft} rows={8} readOnly />
          <Key
            variant="ghost"
            className="w-fit"
            onClick={() => {
              autosave.discardDraft();
              pendingFocus.current = () => textarea.current ?? editKey.current;
            }}
          >
            {COPY.discardDraft}
          </Key>
        </section>
      ) : null}

      {linkedFrom}
      {dayFooter}
    </div>
  );
}
