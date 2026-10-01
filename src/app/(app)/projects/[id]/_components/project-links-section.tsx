"use client";

import { ArrowDown, ArrowUp, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { startTransition, useEffect, useId, useOptimistic, useRef, useState } from "react";
import { Icon, IconKey, Key, SectionLabel, TextField } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import type { Queued } from "@/lib/use-save-queue";
import {
  addProjectLink,
  removeProjectLink,
  reorderProjectLinks,
  updateProjectLink,
} from "@/modules/projects/link-actions";
import { LINKS_COPY } from "@/modules/projects/notes-links-copy";
import {
  addProjectLinkInputSchema,
  linkHost,
  linkText,
  PROJECT_LINK_FIELDS,
  type ProjectLinkField,
  type ProjectLinkSummary,
} from "@/modules/projects/project-link-input";
import {
  applyLinksChange,
  isPendingLinkId,
  PENDING_LINK_PREFIX,
} from "@/modules/projects/project-links-optimistic";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";
import { fieldErrorsOf, useInlineEditor } from "./inline-editor";
import { useProjectDetail } from "./project-detail-context";

type ProjectLinksSectionProps = {
  /** The project's links in order, from the server. */
  links: ProjectLinkSummary[];
};

type LinkValues = { url: string; label: string };
type LinkErrors = Partial<Record<ProjectLinkField, string>>;

/** A focus request older than this is dropped: the render it waited for never came. */
const FOCUS_TTL_MS = 300;

let pendingSerial = 0;

/**
 * Focus for a control that the next renders bring (CLAUDE.md "Focus"): a row's pencil after its
 * form closes, the moved row's arrow after React re-inserts it, the next row after a removal.
 * Returns `focusLater(selector)`; a request no render picks up soon is dropped.
 */
function useFocusRequest() {
  const request = useRef<{ selector: string; at: number } | null>(null);
  useEffect(() => {
    const current = request.current;
    if (!current) return;
    const element = document.querySelector<HTMLElement>(current.selector);
    if (element) {
      request.current = null;
      if (document.activeElement !== element) element.focus();
    } else if (performance.now() - current.at > FOCUS_TTL_MS) {
      request.current = null;
    }
  });
  return (selector: string) => {
    request.current = { selector, at: performance.now() };
  };
}

/** Only http(s) URLs become links (the server and the database already refuse the rest). */
const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

/** The reason a save failed: the server's own message, or a network one. */
function failureReason(queued: Queued<ActionResult<unknown>>): string {
  if (queued.kind === "threw") return PROJECTS_COPY.checkConnection;
  if (queued.kind !== "done" || queued.value.ok) return "";
  const own = Object.values(queued.value.fieldErrors ?? {}).find((m) => m.length)?.[0];
  return own ?? queued.value.error;
}

/**
 * "Enlaces" (SPEC-projects): http(s) links with an optional label, opened in a new tab. Add,
 * edit, move with Subir/Bajar and remove (with "Deshacer"), all optimistic: each change shows
 * at once and is saved through the page's queue; a failure goes back with a notice.
 */
export function ProjectLinksSection({ links }: ProjectLinksSectionProps) {
  const { project, enqueue, toaster, announce } = useProjectDetail();
  const [view, apply] = useOptimistic(links, applyLinksChange);
  const headingId = useId();
  const addKey = useRef<HTMLButtonElement>(null);
  const adder = useInlineEditor(addKey);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The latest list on screen, for calls that run later in the queue (a reorder sends the
  // order as it is when its turn comes, with the ids of links added meanwhile).
  const latest = useRef(view);
  const realIds = useRef(new Map<string, string>());
  useEffect(() => {
    latest.current = view;
  });

  const focusLater = useFocusRequest();
  const editSelector = (id: string) => `[data-link-edit="${CSS.escape(id)}"]`;

  function notSaved(text: string, queued: Queued<ActionResult<unknown>>) {
    toaster.push({
      title: LINKS_COPY.notSavedTitle,
      text: `${text} ${failureReason(queued)}`.trim(),
      tone: "error",
    });
  }

  function add(values: { url: string; label: string | null }, position?: number) {
    const pendingId = `${PENDING_LINK_PREFIX}${++pendingSerial}`;
    const text = linkText(values);
    startTransition(async () => {
      apply({ type: "add", link: { id: pendingId, ...values }, position });
      const queued = await enqueue(null, () =>
        addProjectLink({ projectId: project.id, ...values, position }),
      );
      if (queued.kind === "done" && queued.value.ok) {
        realIds.current.set(pendingId, queued.value.data.link.id);
        announce(position === undefined ? LINKS_COPY.added(text) : LINKS_COPY.restored(text));
        return;
      }
      notSaved(
        position === undefined ? LINKS_COPY.notSaved.add : LINKS_COPY.notSaved.restore,
        queued,
      );
    });
  }

  function update(link: ProjectLinkSummary, values: { url: string; label: string | null }) {
    startTransition(async () => {
      apply({ type: "update", id: link.id, ...values });
      const queued = await enqueue(`link:${link.id}`, () =>
        updateProjectLink({ projectId: project.id, id: link.id, ...values }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        announce(LINKS_COPY.updated(linkText(values)));
        return;
      }
      notSaved(LINKS_COPY.notSaved.update, queued);
    });
  }

  function remove(link: ProjectLinkSummary) {
    const index = view.findIndex((item) => item.id === link.id);
    const neighbor = view[index + 1] ?? view[index - 1];
    setEditingId(null);
    // The row (and its form) goes: focus moves to the next one, or to "Agregar enlace".
    if (neighbor) focusLater(editSelector(neighbor.id));
    else addKey.current?.focus();
    const text = linkText(link);
    startTransition(async () => {
      apply({ type: "remove", id: link.id });
      const queued = await enqueue(null, () =>
        removeProjectLink({ projectId: project.id, id: link.id }),
      );
      if (queued.kind === "done" && queued.value.ok) {
        const { removed, position } = queued.value.data;
        toaster.push({
          title: LINKS_COPY.removedTitle,
          text: LINKS_COPY.removed(text),
          action: {
            label: LINKS_COPY.undo,
            run: () => add({ url: removed.url, label: removed.label }, position),
          },
        });
        return;
      }
      notSaved(LINKS_COPY.notSaved.remove, queued);
    });
  }

  function move(link: ProjectLinkSummary, delta: -1 | 1) {
    const from = view.findIndex((item) => item.id === link.id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= view.length) return;
    focusLater(
      `[data-link-move="${delta < 0 ? "up" : "down"}"][data-link-id="${CSS.escape(link.id)}"]`,
    );
    announce(LINKS_COPY.moved(linkText(link), to + 1, view.length));
    startTransition(async () => {
      apply({ type: "move", id: link.id, to });
      // Keyed: of a quick series of moves, the one in flight and then only the last are sent,
      // each with the whole order as it is on screen when its turn comes.
      const queued = await enqueue(`links-order:${project.id}`, () =>
        reorderProjectLinks({
          projectId: project.id,
          ids: latest.current
            .map((item) => realIds.current.get(item.id) ?? item.id)
            .filter((id) => !isPendingLinkId(id)),
        }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) return;
      notSaved(LINKS_COPY.notSaved.move, queued);
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionLabel
        id={headingId}
        as="h2"
        title={LINKS_COPY.section}
        count={view.length > 0 ? view.length : undefined}
        // On screen a bare number; heard, "Enlaces, 2 enlaces" (as the projects list does).
        aria-label={view.length > 0 ? LINKS_COPY.sectionName(view.length) : undefined}
      />
      {view.length > 0 ? (
        <ul aria-label={LINKS_COPY.listLabel} className="bo-list">
          {view.map((link, index) =>
            link.id === editingId ? (
              <li key={link.id} className="bg-surface p-4">
                <LinkForm
                  label={LINKS_COPY.editForm}
                  initial={{ url: link.url, label: link.label ?? "" }}
                  onSave={(values) => {
                    setEditingId(null);
                    focusLater(editSelector(link.id));
                    if (values.url !== link.url || values.label !== link.label) {
                      update(link, values);
                    }
                  }}
                  onCancel={() => {
                    setEditingId(null);
                    focusLater(editSelector(link.id));
                  }}
                  onRemove={() => remove(link)}
                />
              </li>
            ) : (
              <LinkRow
                key={link.id}
                link={link}
                first={index === 0}
                last={index === view.length - 1}
                onMove={(delta) => move(link, delta)}
                onEdit={() => setEditingId(link.id)}
              />
            ),
          )}
        </ul>
      ) : (
        <p className="bo-card bo-text-body-sm text-text-secondary">{LINKS_COPY.empty}</p>
      )}
      {adder.editing ? (
        <div className="bo-card">
          <LinkForm
            label={LINKS_COPY.addForm}
            initial={{ url: "", label: "" }}
            onSave={(values) => {
              adder.close();
              add(values);
            }}
            onCancel={adder.close}
          />
        </div>
      ) : (
        <Key
          ref={addKey}
          variant="ghost"
          icon={Plus}
          className="w-fit"
          onClick={() => {
            setEditingId(null);
            adder.open();
          }}
        >
          {LINKS_COPY.add}
        </Key>
      )}
    </section>
  );
}

function LinkRow({
  link,
  first,
  last,
  onMove,
  onEdit,
}: {
  link: ProjectLinkSummary;
  first: boolean;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
}) {
  const text = linkText(link);
  const pending = isPendingLinkId(link.id);
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="bo-text-body-strong truncate">{text}</span>
        <Icon icon={ExternalLink} size="sm" className="shrink-0 text-text-secondary" />
      </span>
      {link.label ? (
        <span className="bo-text-caption block truncate text-text-secondary">
          {linkHost(link.url)}
        </span>
      ) : null}
    </>
  );
  return (
    <li data-link-row={link.id} className="flex min-h-14 items-center gap-1 bg-surface pr-2">
      {isWebUrl(link.url) ? (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={link.url}
          className="bo-link-row min-w-0 flex-1 rounded-md py-2 pl-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          {content}
          <span className="sr-only"> {LINKS_COPY.newTab}</span>
        </a>
      ) : (
        <span className="min-w-0 flex-1 py-2 pl-4">{content}</span>
      )}
      <MoveKey link={link} up disabled={first || pending} onMove={onMove} />
      <MoveKey link={link} up={false} disabled={last || pending} onMove={onMove} />
      <IconKey
        icon={Pencil}
        label={LINKS_COPY.edit(text)}
        variant="ghost"
        tooltip={false}
        data-link-edit={link.id}
        aria-disabled={pending || undefined}
        className={cn(pending && "is-disabled")}
        onClick={() => {
          if (!pending) onEdit();
        }}
      />
    </li>
  );
}

function MoveKey({
  link,
  up,
  disabled,
  onMove,
}: {
  link: ProjectLinkSummary;
  up: boolean;
  disabled: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  const text = linkText(link);
  return (
    <IconKey
      icon={up ? ArrowUp : ArrowDown}
      label={up ? LINKS_COPY.moveUp(text) : LINKS_COPY.moveDown(text)}
      variant="ghost"
      // No tooltip: the list clips its overflow (rounded corners), as in the areas list.
      tooltip={false}
      data-link-move={up ? "up" : "down"}
      data-link-id={link.id}
      // aria-disabled, not disabled: at the top or bottom, focus stays on the key.
      aria-disabled={disabled || undefined}
      className={cn(disabled && "is-disabled")}
      onClick={() => {
        if (!disabled) onMove(up ? -1 : 1);
      }}
    />
  );
}

/** URL and label, then "Guardar" and "Cancelar" (and "Quitar enlace" when editing). */
function LinkForm({
  label,
  initial,
  onSave,
  onCancel,
  onRemove,
}: {
  label: string;
  initial: LinkValues;
  onSave: (values: { url: string; label: string | null }) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<LinkErrors>({});
  const urlInput = useRef<HTMLInputElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  const ids = useId();

  function submit() {
    // The add schema checks the same URL and label as editing; the id fields are placeholders.
    const parsed = addProjectLinkInputSchema.safeParse({
      projectId: "00000000-0000-4000-8000-000000000000",
      url: values.url,
      label: values.label,
    });
    if (!parsed.success) {
      const found = fieldErrorsOf(parsed.error, PROJECT_LINK_FIELDS);
      setErrors(found);
      (found.url ? urlInput : labelInput).current?.focus();
      return;
    }
    onSave({ url: parsed.data.url, label: parsed.data.label });
  }

  function change(field: ProjectLinkField, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  return (
    <form
      noValidate
      aria-label={label}
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // The notice viewport also listens for Esc on the document: this one is the form's.
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <TextField
        ref={urlInput}
        id={`${ids}-url`}
        type="url"
        inputMode="url"
        autoComplete="url"
        autoCapitalize="none"
        spellCheck={false}
        label={LINKS_COPY.urlLabel}
        value={values.url}
        autoFocus
        error={errors.url}
        help={LINKS_COPY.urlHelp}
        onChange={(event) => change("url", event.target.value)}
      />
      <TextField
        ref={labelInput}
        id={`${ids}-label`}
        label={LINKS_COPY.labelLabel}
        value={values.label}
        error={errors.label}
        help={LINKS_COPY.labelHelp}
        onChange={(event) => change("label", event.target.value)}
      />
      <p role="status" className="sr-only">
        {errors.url ?? errors.label ?? ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Key type="submit" variant="signal">
          {LINKS_COPY.save}
        </Key>
        <Key variant="ghost" onClick={onCancel}>
          {LINKS_COPY.cancel}
        </Key>
        {onRemove ? (
          <Key variant="ghost" icon={Trash2} className="sm:ml-auto" onClick={onRemove}>
            {LINKS_COPY.remove}
          </Key>
        ) : null}
      </div>
    </form>
  );
}
