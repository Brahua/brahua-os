// Name search for the `[[` picker of the notes (SPEC-notes "Fuentes de enlace"): every module's
// `note-link-source.ts` matches its names the same way, without accents or case. Server only.
//
// No `unaccent` here: the extension arrives with N4's migration (and may be missing from the local
// embedded Postgres). `translate` folds the accents Spanish (and its neighbours) use, on both
// cases, after `lower` (which, under a C locale, only lowers ASCII); the text typed is folded the
// same way in JavaScript. Wildcards typed by the owner (`%`, `_`, `\`) are escaped: they match
// themselves.
import "server-only";
import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { foldSearchText } from "./text";

/** Accented letters and what each folds to (same position). Exported for a test. */
export const ACCENTED = "áàäâãåéèëêíìïîóòöôõúùüûñçýÿÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇÝ";
export const PLAIN = "aaaaaaeeeeiiiiooooouuuuncyyaaaaaaeeeeiiiiooooouuuuncy";

/** `%`, `_` and `\` match themselves in a LIKE pattern (Postgres' default escape is `\`). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** A column (or expression) folded like `foldSearchText`. */
export function foldedName(column: AnyColumn | SQL): SQL<string> {
  return sql<string>`translate(lower(${column}), ${ACCENTED}, ${PLAIN})`;
}

/** Whether the folded name contains the folded text (an empty text matches everything). */
export function nameContains(column: AnyColumn | SQL, text: string): SQL {
  return sql`${foldedName(column)} like ${`%${escapeLike(foldSearchText(text))}%`}`;
}

/** 0 when the folded name starts with the folded text, 1 otherwise (prefix matches go first). */
export function prefixRank(column: AnyColumn | SQL, text: string): SQL<number> {
  return sql<number>`case when ${foldedName(column)} like ${`${escapeLike(foldSearchText(text))}%`} then 0 else 1 end`;
}
