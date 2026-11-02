// The link of a track (the course's page, SPEC-learning "Modelo de datos"): only `http` and
// `https`, no credentials, no spaces, at most 2000 characters. The server never follows it (no
// fetch, no preview, SPEC-learning "Límites"): the screen only shows the domain and opens it in a
// new tab with `rel="noopener noreferrer"`. Pure and client-safe: the form, the Zod schema and the
// screen share it. The same rules as a recipe's link in `household` (a module `learning` may not
// import).
import { TRACK_URL_MAX_LENGTH } from "./learning-constants";

/** Control characters (NUL among them: Postgres text can't hold it) and DEL. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The link as it is stored when it is acceptable, or null: trimmed, with the scheme in lowercase
 * (the table's CHECK is case-sensitive, so `HTTPS://…` is stored as `https://…` and the CHECK, this
 * function and the schema accept exactly the same texts).
 */
export function acceptableTrackUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || [...trimmed].length > TRACK_URL_MAX_LENGTH) return null;
  if (/\s/.test(trimmed) || CONTROL.test(trimmed)) return null;
  // The table's CHECK reads the start of the text, so that is what is checked here too.
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const text = trimmed.replace(/^https?/i, (scheme) => scheme.toLowerCase());
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // `https://curso.com@evil.example` shows one host and goes to another: no credentials.
    if (url.username !== "" || url.password !== "") return null;
    if (url.hostname === "") return null;
    return text;
  } catch {
    return null;
  }
}

/** The domain to show for a track's link («platzi.com»), or null when it isn't acceptable. */
export function trackDomain(value: string): string | null {
  const accepted = acceptableTrackUrl(value);
  if (!accepted) return null;
  return new URL(accepted).hostname.replace(/^www\./, "");
}
