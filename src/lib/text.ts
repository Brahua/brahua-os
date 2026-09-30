// Text helpers shared by the server and the client.

/** Used when a name has no letters or digits to build a slug from (e.g. only symbols). */
export const FALLBACK_SLUG = "item";

/**
 * URL- and key-safe slug: lowercase ASCII letters and digits separated by single hyphens.
 * Accents and ñ lose their marks ("Educación" → "educacion", "Año" → "ano"); anything else
 * (spaces, symbols, emoji) becomes a separator. Returns `fallback` when nothing is left.
 */
export function slugify(input: string, fallback = FALLBACK_SLUG): string {
  const slug = input
    // Split letters from their accents (é → e + ◌́) and drop the marks.
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    // Letters without a decomposition that still read naturally in ASCII.
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ø/g, "o")
    .replace(/đ/g, "d")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/**
 * First slug not in `taken`: `base`, then `base-2`, `base-3`… (SPEC-core: the slug is unique and
 * stable, so a second "Música" gets `musica-2`).
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
