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
import "./markdown.css";
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

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type MarkdownProps = {
  /** Markdown source (untrusted). */
  children: string;
  /**
   * Levels to push headings down so they fit the page outline: under a section's h2, pass 2
   * and `# Title` renders as an h3. Clamped to h6. The look follows the written level.
   */
  headingOffset?: 0 | 1 | 2 | 3 | 4 | 5;
  className?: string;
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

const BASE_COMPONENTS: Partial<Components> = {
  /**
   * Only fragments, mailto and http(s) are links (see linkKind: no relative or
   * protocol-relative URLs). External ones open in a new tab, without access to this page or a
   * referrer.
   */
  a({ href, children, ...props }) {
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
        <span className="sr-only"> {MARKDOWN_COPY.newTab}</span>
      </a>
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
        <span className="sr-only"> {MARKDOWN_COPY.newTab}</span>
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
  remarkPlugins: [remarkGfm],
  rehypePlugins: [[rehypeSanitize, MARKDOWN_SCHEMA], rehypePrefixFragmentLinks],
  remarkRehypeOptions: {
    // The sanitizer prefixes ids once; remark-rehype must not do it too ("user-content-" twice).
    clobberPrefix: "",
    footnoteLabel: MARKDOWN_COPY.footnotes,
    footnoteBackLabel: MARKDOWN_COPY.footnoteBack,
  },
} satisfies Partial<Options>;

/** Renders untrusted Markdown (GFM) as sanitized, design-system styled HTML. */
export function Markdown({ children, headingOffset = 0, className }: MarkdownProps) {
  return (
    <div className={cn("bo-markdown", className)}>
      <ReactMarkdown
        {...PLUGINS}
        components={{ ...BASE_COMPONENTS, ...headingComponents(headingOffset) }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
