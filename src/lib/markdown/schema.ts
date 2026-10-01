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

export const MARKDOWN_COPY = {
  newTab: "(se abre en una pestaña nueva)",
  image: (alt: string | null) => (alt ? `Imagen: ${alt}` : "Imagen"),
  done: "Hecho:",
  pending: "Pendiente:",
  table: "Tabla",
  footnotes: "Notas al pie",
  footnoteBack: "Volver al texto",
} as const;
