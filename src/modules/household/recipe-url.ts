// The link of a recipe (SPEC-household "Decisiones"): only `http` and `https`, no credentials, no
// spaces, at most 2000 characters. The server never follows it (no fetch, no preview): the screen
// only shows the domain and opens it in a new tab with `rel="noopener noreferrer"`. Pure and
// client-safe: the form, the Zod schema and the screen share it.
import { RECIPE_URL_MAX_LENGTH } from "./recipe-constants";

/** Control characters (NUL among them: Postgres text can't hold it) and DEL. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The link as it is stored when it is acceptable, or null: trimmed, with the scheme in lowercase
 * (the table's CHECK is case-sensitive, so `HTTPS://…` is stored as `https://…` and the CHECK, this
 * function and the schema accept exactly the same texts).
 */
export function acceptableRecipeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || [...trimmed].length > RECIPE_URL_MAX_LENGTH) return null;
  if (/\s/.test(trimmed) || CONTROL.test(trimmed)) return null;
  // The table's CHECK reads the start of the text, so that is what is checked here too.
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const text = trimmed.replace(/^https?/i, (scheme) => scheme.toLowerCase());
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // `https://tienda.com@evil.example` shows one host and goes to another: no credentials.
    if (url.username !== "" || url.password !== "") return null;
    if (url.hostname === "") return null;
    return text;
  } catch {
    return null;
  }
}

/** The domain to show next to a recipe («cookpad.com»), or null when the link isn't acceptable. */
export function recipeDomain(value: string): string | null {
  const accepted = acceptableRecipeUrl(value);
  if (!accepted) return null;
  return new URL(accepted).hostname.replace(/^www\./, "");
}
