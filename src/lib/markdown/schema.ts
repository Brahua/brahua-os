// Sanitization rules and copy of the Markdown renderer (./markdown.tsx). Client-safe.
import { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";

/**
 * GitHub's schema (what rehype-sanitize ships), narrowed: links may only be http, https or
 * mailto (no irc or xmpp), and images and quotes only http or https. Relative links (`#…`,
 * `/…`) carry no scheme and stay: footnotes need them. Raw HTML in the source never gets here
 * as markup: the sanitizer drops those nodes (the text between tags stays as text).
 */
export const MARKDOWN_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Column alignment of GFM tables (`| :-- | --: |`).
    th: [...(defaultSchema.attributes?.th ?? []), ["align", "left", "center", "right"]],
    td: [...(defaultSchema.attributes?.td ?? []), ["align", "left", "center", "right"]],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
    cite: ["http", "https"],
    longDesc: ["http", "https"],
  },
};

/** Absolute http(s) URLs: the ones that leave the app (opened in a new tab). */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

/** The prefix the sanitizer puts on every id (and the footnote links must point to). */
export const CLOBBER_PREFIX = "user-content-";

/**
 * How a link may render, or null when it must be plain text. Only three kinds are links: a
 * fragment of this page (`#…`, footnotes), `mailto:` and absolute http(s). Everything else
 * is text, including what the sanitizer lets through as "relative": `/path`, protocol-relative
 * `//evil.example` and its backslash forms (`/\evil`, `\\evil`), which browsers open on
 * another host.
 */
export function linkKind(href: string): "fragment" | "mailto" | "external" | null {
  const value = href.trim();
  if (/^#[^\s\\]*$/.test(value)) return "fragment";
  if (/^mailto:/i.test(value)) return "mailto";
  if (isExternalHref(value)) return "external";
  return null;
}

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * Rehype step after the sanitizer: it prefixed every id with CLOBBER_PREFIX (so notes can't
 * clobber the page's ids), and here in-page links (`#fn-1`, footnotes) follow them.
 */
export function rehypePrefixFragmentLinks() {
  function visit(node: HastNode) {
    const properties = node.properties;
    const href = properties?.href;
    if (
      properties &&
      node.type === "element" &&
      node.tagName === "a" &&
      typeof href === "string" &&
      href.startsWith("#") &&
      !href.startsWith(`#${CLOBBER_PREFIX}`) &&
      href.length > 1
    ) {
      properties.href = `#${CLOBBER_PREFIX}${href.slice(1)}`;
    }
    node.children?.forEach(visit);
  }
  return (tree: HastNode) => visit(tree);
}

export const MARKDOWN_COPY = {
  newTab: "(se abre en una pestaña nueva)",
  image: (alt: string | null) => (alt ? `Imagen: ${alt}` : "Imagen"),
  done: "Hecho:",
  pending: "Pendiente:",
  table: "Tabla",
  footnotes: "Notas al pie",
  footnoteBack: "Volver al texto",
} as const;
