// Validation and client types of a project's links (P5, SPEC-projects "Enlaces"). Client-safe:
// the forms run the same schemas first, and the server actions are the authority.
import { z } from "zod";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { PROJECT_LINK_LABEL_MAX_LENGTH, PROJECT_LINK_URL_MAX_LENGTH } from "./project-constants";
import { PROJECT_ERRORS } from "./project-input";

export { PROJECT_LINK_LABEL_MAX_LENGTH, PROJECT_LINK_URL_MAX_LENGTH } from "./project-constants";

export const PROJECT_LINK_ERRORS = {
  urlRequired: "Escribe la dirección del enlace.",
  urlInvalid: "Escribe una dirección válida, como https://ejemplo.com.",
  urlScheme: "Solo se aceptan direcciones http:// o https://.",
  urlCredentials: "Quita el usuario y la contraseña de la dirección (no se guardan en enlaces).",
  urlTooLong: `Usa ${PROJECT_LINK_URL_MAX_LENGTH} caracteres como máximo.`,
  labelTooLong: `Usa ${PROJECT_LINK_LABEL_MAX_LENGTH} caracteres como máximo.`,
  labelInvisible: "Quita los caracteres invisibles o de control de la etiqueta.",
  notFound: "Este enlace ya no existe (se quitó en otra pestaña). La lista ya está al día.",
  staleOrder: "Los enlaces cambiaron en otra pestaña; la lista ya está al día. Vuelve a moverlo.",
} as const;

/** A link as the page shows it. */
export type ProjectLinkSummary = {
  id: string;
  url: string;
  label: string | null;
};

/** Anything that starts like a scheme (`ftp:`, `javascript:`, `mailto:`…). */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * A host with a port and no scheme (`localhost:3000/x`, `ejemplo.com:8080`): it looks like a
 * scheme to HAS_SCHEME, but it is an address that just needs `https://`.
 */
const HOST_AND_PORT = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i;

/**
 * What `value` stores as, or why it can't. Without a scheme, `https://` is assumed (people
 * paste "ejemplo.com", or "localhost:3000"). Parsed with the WHATWG URL parser, so what is stored is its normalized
 * form (lowercase scheme and host, spaces percent-encoded); only http and https with a host,
 * and no username or password.
 */
export function parseLinkUrl(
  value: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, error: PROJECT_LINK_ERRORS.urlRequired };
  // Control characters never reach the parser (it would silently drop tabs and line breaks).
  if (/\p{Cc}/u.test(trimmed)) return { ok: false, error: PROJECT_LINK_ERRORS.urlInvalid };
  const hasScheme = HAS_SCHEME.test(trimmed) && !HOST_AND_PORT.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: PROJECT_LINK_ERRORS.urlInvalid };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: PROJECT_LINK_ERRORS.urlScheme };
  }
  if (!parsed.hostname) return { ok: false, error: PROJECT_LINK_ERRORS.urlInvalid };
  // `https://banco.com@evil.example` reads as one host and goes to another; and a password in
  // a link would sit in the database and the export in plain text.
  if (parsed.username || parsed.password) {
    return { ok: false, error: PROJECT_LINK_ERRORS.urlCredentials };
  }
  if (parsed.href.length > PROJECT_LINK_URL_MAX_LENGTH) {
    return { ok: false, error: PROJECT_LINK_ERRORS.urlTooLong };
  }
  return { ok: true, url: parsed.href };
}

const url = z.string({ error: PROJECT_LINK_ERRORS.urlRequired }).transform((value, context) => {
  const result = parseLinkUrl(value);
  if (result.ok) return result.url;
  context.addIssue({ code: "custom", message: result.error });
  return z.NEVER;
});

/** Optional label: normalized like names, up to 80 characters; empty clears it. */
const label = z
  .string()
  .nullish()
  .transform((value) => normalizeName(value ?? ""))
  .pipe(
    z
      .string()
      .max(PROJECT_LINK_LABEL_MAX_LENGTH, PROJECT_LINK_ERRORS.labelTooLong)
      .refine((value) => !hasInvisibleCharacters(value), PROJECT_LINK_ERRORS.labelInvisible),
  )
  .transform((value) => (value === "" ? null : value));

const projectId = z.uuid({ error: PROJECT_ERRORS.notFound });
const linkId = z.uuid({ error: PROJECT_LINK_ERRORS.notFound });

/**
 * Adds a link at the end, or at `position` (0-based; past the end means the end): "Deshacer"
 * after removing one puts it back where it was.
 */
export const addProjectLinkInputSchema = z.object({
  projectId,
  url,
  label,
  position: z.number().int().min(0).max(10_000).optional(),
});

export const updateProjectLinkInputSchema = z.object({ projectId, id: linkId, url, label });

export const removeProjectLinkInputSchema = z.object({ projectId, id: linkId });

/** The project's links in their new order: exactly its links, each once. */
export const reorderProjectLinksInputSchema = z.object({
  projectId,
  ids: z.array(linkId).max(1_000),
});

export type AddProjectLinkInput = z.output<typeof addProjectLinkInputSchema>;
export type UpdateProjectLinkInput = z.output<typeof updateProjectLinkInputSchema>;

/** Field names of the link form, in order (focus goes to the first invalid one). */
export const PROJECT_LINK_FIELDS = ["url", "label"] as const;
export type ProjectLinkField = (typeof PROJECT_LINK_FIELDS)[number];

/** The host as people read it ("www." dropped), or the whole URL if it has none. */
export function linkHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "") || value;
  } catch {
    return value;
  }
}

/**
 * Whether a label reads like a web address of another site (`banco.com`, `www.banco.com/x`):
 * then the real host is shown prominently next to it. A label naming the link's own site
 * (or a subdomain of it), or one that isn't address-like, is fine.
 */
export function labelMisleads(label: string, host: string): boolean {
  const match = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]\S*)?$/i.exec(label.trim());
  if (!match) return false;
  const shown = match[1].toLowerCase().replace(/^www\./, "");
  const real = host.toLowerCase();
  return shown !== real && !real.endsWith(`.${shown}`) && !shown.endsWith(`.${real}`);
}

/** What a link shows: its label, or its host. */
export function linkText(link: Pick<ProjectLinkSummary, "url" | "label">): string {
  return link.label ?? linkHost(link.url);
}
