// Safe Markdown rendering, shared by project notes (SPEC-projects "Notas") and, later, the
// Markdown viewer and the `notes` module. No hooks and no "use client": it renders in Server
// Components (no JavaScript shipped), and client code that needs a live preview loads it lazily.
//
// Layers, from the parser out:
// 1. Raw HTML is never parsed: without rehype-raw (never add it) an HTML tag in the source stays
//    an opaque "raw" node, and the sanitizer drops it (the text between tags stays as text).
// 2. rehype-sanitize (GitHub's schema, narrowed in ./schema.ts) drops anything left that isn't
//    plain document markup: scripts, event handlers, styles, iframes, and URLs whose scheme isn't
//    http(s) (mailto for links), so `javascript:`, `data:` and `vbscript:` go.
// 3. react-markdown's own URL filter (defaultUrlTransform) also blanks unsafe schemes.
// 4. The components below decide how links, images, checkboxes and tables look.
//
// `[[type:id|Nombre]]` links of the notes (./note-links.ts) are set aside before parsing and put
// back by a remark plugin as links whose href the app builds; the sanitizer still runs after them.
import "./markdown.css";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import {
  CLOBBER_PREFIX,
  isExternalHref,
  linkKind,
  MARKDOWN_COPY,
  MARKDOWN_SCHEMA,
  rehypePrefixFragmentLinks,
} from "./schema";
import {
  isNoteLinkHref,
  isNoteLinkType,
  noteLinkKey,
  noteLinkView,
  remarkNoteLinks,
  tokenizeNoteLinks,
  type NoteLinkResolutions,
  type TokenizedNoteLinks,
  type UnknownNoteLinks,
} from "./note-links";
import {
  hasPlaceholderCharacters,
  remarkTaskItems,
  type LinkedTaskState,
  type TaskItemMark,
} from "./task-items";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * What the notes draw next to task list items (SPEC-notes "Línea → tarea", "Casilla de tarea").
 * Without it (projects' and tasks' notes) the items render as before, read-only.
 */
export type MarkdownTaskItems = {
  /**
   * After the text of an unchecked item that can become a task (before its sublist, if it has
   * one): its index among the task items, its text as written and as plain words.
   */
  open?: (item: { index: number; text: string; plain: string }) => ReactNode;
  /** Before an item that starts with a `[[task:…]]` link (a task that is gone gets nothing). */
  linked?: (item: { id: string; name: string; done: boolean | null }) => ReactNode;
};

export type MarkdownProps = {
  /** Markdown source (untrusted). */
  children: string;
  /**
   * Levels to push headings down so they fit the page outline: under a section's h2, pass 2
   * and `# Title` renders as an h3. Clamped to h6. The look follows the written level.
   */
  headingOffset?: 0 | 1 | 2 | 3 | 4 | 5;
  className?: string;
  /**
   * What the server resolved for the `[[type:id|Nombre]]` links (current names, deleted targets).
   * Without it, links show their saved name and are never drawn as gone.
   */
  noteLinks?: NoteLinkResolutions;
  /**
   * A link missing from `noteLinks`: `"deleted"` when they were resolved for exactly this text (the
   * server's render), `"saved"` (default) when the text may hold links nobody looked up yet (the
   * editor's text: a link just inserted shows its saved name).
   */
  unknownNoteLinks?: UnknownNoteLinks;
  /** The notes' controls on task list items (see `MarkdownTaskItems`). */
  taskItems?: MarkdownTaskItems;
};

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** react-markdown hands every component its syntax tree node: it must never reach the DOM. */
function domProps<Props extends { node?: unknown }>(props: Props): Omit<Props, "node"> {
  const { node, ...rest } = props;
  void node;
  return rest;
}

/** The footnotes' (screen-reader only) heading: one level under the page's section. */
const FOOTNOTE_LABEL_ID = `${CLOBBER_PREFIX}footnote-label`;

function headingComponents(offset: number): Partial<Components> {
  const entries = HEADING_LEVELS.map((level) => {
    const Heading: Components["h1"] = ({ className, ...props }) => {
      const shown = props.id === FOOTNOTE_LABEL_ID ? 1 : level;
      const Tag = `h${Math.min(6, shown + offset) as HeadingLevel}` as const;
      return <Tag {...domProps(props)} className={cn(`bo-md-h${level}`, className)} />;
    };
    return [`h${level}`, Heading] as const;
  });
  return Object.fromEntries(entries);
}

/**
 * What marks a link that leaves the app (new tab): an icon (hidden from screen readers) and the
 * spoken «(se abre en una pestaña nueva)». A `[[…]]` link has neither, so the two never depend on
 * color alone to tell apart.
 */
function ExternalMark() {
  return (
    <>
      <ExternalLink aria-hidden className="bo-md-external-icon" size={12} strokeWidth={2} />
      <span className="sr-only"> {MARKDOWN_COPY.newTab}</span>
    </>
  );
}

const BASE_COMPONENTS: Partial<Components> = {
  /**
   * Only fragments, mailto and http(s) are links (see linkKind: no relative or
   * protocol-relative URLs). External ones open in a new tab, without access to this page or a
   * referrer.
   */
  a({ href, children, ...props }) {
    // A note link (its marker survives the sanitizer only with a known type): an app route, in the
    // same tab, and only if the href is one the app builds.
    const noteLink = (props as Record<string, unknown>)["data-note-link"];
    if (typeof noteLink === "string" && isNoteLinkType(noteLink)) {
      if (!href || !isNoteLinkHref(href)) return <span>{children}</span>;
      return (
        <Link href={href} className="bo-md-note-link" data-note-link={noteLink}>
          {children}
        </Link>
      );
    }
    const kind = href ? linkKind(href) : null;
    if (!href || !kind) return <span>{children}</span>;
    if (kind !== "external") {
      return (
        <a {...domProps(props)} href={href}>
          {children}
        </a>
      );
    }
    return (
      <a {...domProps(props)} href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
        <ExternalMark />
      </a>
    );
  },
  /** A `[[…]]` link whose target is gone: plain, muted text (never a link). */
  span({ children, ...props }) {
    const gone = (props as Record<string, unknown>)["data-note-link-gone"] !== undefined;
    return (
      <span {...domProps(props)} className={gone ? "bo-md-note-link-gone" : undefined}>
        {children}
      </span>
    );
  },
  /**
   * Images are never loaded: a remote image in a note would tell its server when (and from
   * where) the note is read, and could change after it was written. It becomes a link to the
   * image instead, so nothing written is lost.
   */
  img({ src, alt }) {
    const text = MARKDOWN_COPY.image(alt?.trim() || null);
    if (typeof src !== "string" || !isExternalHref(src)) return <span>{text}</span>;
    return (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="bo-md-image-link">
        {text}
        <ExternalMark />
      </a>
    );
  },
  /**
   * Task list boxes are read-only: drawn, not a form control (a disabled checkbox with no label
   * of its own reads poorly). Screen readers hear "Hecho:" or "Pendiente:" before the item.
   */
  input({ type, checked }) {
    if (type !== "checkbox") return null;
    return (
      <>
        <span aria-hidden className={cn("bo-md-check", checked && "is-checked")} />
        <span className="sr-only">{checked ? MARKDOWN_COPY.done : MARKDOWN_COPY.pending}</span>
      </>
    );
  },
  /** Wide tables scroll sideways inside their own box (focusable, so the keyboard can too). */
  table(props) {
    return (
      <div className="bo-md-table" role="group" aria-label={MARKDOWN_COPY.table} tabIndex={0}>
        <table {...domProps(props)} />
      </div>
    );
  },
};

const PLUGINS = {
  rehypePlugins: [[rehypeSanitize, MARKDOWN_SCHEMA], rehypePrefixFragmentLinks],
  remarkRehypeOptions: {
    // The sanitizer prefixes ids once; remark-rehype must not do it too ("user-content-" twice).
    clobberPrefix: "",
    footnoteLabel: MARKDOWN_COPY.footnotes,
    footnoteBackLabel: MARKDOWN_COPY.footnoteBack,
  },
} satisfies Partial<Options>;

/**
 * The `li` of a render with task item controls: the mark the plugin left (`data-md-item`) says
 * which control goes in it. `marks` is filled while parsing, before any `li` renders.
 */
function taskItemComponents(
  marks: readonly TaskItemMark[],
  renderers: MarkdownTaskItems,
): Partial<Components> {
  return {
    li({ children, className, ...props }) {
      const { "data-md-item": raw, ...rest } = domProps(props) as Record<string, unknown>;
      const mark = typeof raw === "string" ? marks[Number(raw)] : undefined;
      if (mark?.kind === "open") {
        // Right after the item's own text: before its sublist, if it has one.
        const parts = Children.toArray(children);
        const sublist = parts.findIndex(
          (part) => isValidElement(part) && (part.type === "ul" || part.type === "ol"),
        );
        const at = sublist === -1 ? parts.length : sublist;
        const control = renderers.open?.({ index: mark.index, text: mark.text, plain: mark.plain });
        return (
          <li {...rest} className={className}>
            {parts.slice(0, at)}
            {control}
            {parts.slice(at)}
          </li>
        );
      }
      if (mark?.kind === "linked") {
        return (
          <li
            {...rest}
            className={cn("bo-md-task-linked", mark.gone && "is-gone", className)}
            data-md-task={mark.id}
          >
            {mark.gone
              ? null
              : renderers.linked?.({ id: mark.id, name: mark.name, done: mark.done })}
            {children}
          </li>
        );
      }
      return (
        <li {...rest} className={className}>
          {children}
        </li>
      );
    },
  };
}

/** How a task link at the start of an item reads now (its checkbox needs the state). */
function linkedTaskState(
  link: TokenizedNoteLinks["links"][number],
  resolutions: NoteLinkResolutions | undefined,
  unknown: UnknownNoteLinks,
): LinkedTaskState {
  const view = noteLinkView(link, resolutions, unknown);
  if (view.kind === "gone") return { name: link.name, done: null, gone: true };
  const key = noteLinkKey(link.type, link.id);
  const resolved = resolutions && Object.hasOwn(resolutions, key) ? resolutions[key] : undefined;
  return { name: view.name, done: resolved?.done ?? null, gone: false };
}

/** Renders untrusted Markdown (GFM) as sanitized, design-system styled HTML. */
export function Markdown({
  children,
  headingOffset = 0,
  className,
  noteLinks,
  unknownNoteLinks = "saved",
  taskItems,
}: MarkdownProps) {
  // A new nonce on every render (the placeholders never reach the output).
  const tokens = tokenizeNoteLinks(children);
  const linkOptions = { tokens, resolutions: noteLinks, unknown: unknownNoteLinks };
  // The notes' task item controls: marked by a plugin that runs before the links are put back.
  const marks: TaskItemMark[] = [];
  const taskOptions = {
    tokens,
    convertible: !hasPlaceholderCharacters(children),
    describe: (link: TokenizedNoteLinks["links"][number]) =>
      linkedTaskState(link, noteLinks, unknownNoteLinks),
    marks,
  };
  return (
    <div className={cn("bo-markdown", className)}>
      <ReactMarkdown
        {...PLUGINS}
        remarkPlugins={
          taskItems
            ? [remarkGfm, [remarkTaskItems, taskOptions], [remarkNoteLinks, linkOptions]]
            : [remarkGfm, [remarkNoteLinks, linkOptions]]
        }
        components={{
          ...BASE_COMPONENTS,
          ...headingComponents(headingOffset),
          ...(taskItems ? taskItemComponents(marks, taskItems) : {}),
        }}
      >
        {tokens.source}
      </ReactMarkdown>
    </div>
  );
}
