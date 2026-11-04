// N4: the search inside Notas (SPEC-notes "Búsqueda"), the pure half. Client-safe: the screen checks
// the minimum length with the same function the server uses, and draws the fragment from the parts.
//
// The owner's text never reaches a `tsquery` as syntax. `searchWords` keeps only runs of letters and
// numbers (`\p{L}\p{N}`, after NFC), so `&`, `|`, `!`, `:`, `'`, `(`, `<->`, `*` or emoji can't
// become operators: they only split words. search-data.ts then passes each word as its OWN bound
// parameter to `to_tsquery(config, $n)` with the suffix `:*` (a prefix), and joins the per-word
// queries with `&&` in SQL. `websearch_to_tsquery`/`plainto_tsquery` were not used: they can't
// express a prefix.
//
// The fragment comes from `ts_headline` with private-use markers (U+E000 opens, U+E001 closes) in
// place of Postgres' `<b>`: the screen splits on them and draws `<mark>`; everything else is text,
// never HTML. The server strips those characters from the body before the headline, so a note
// can't forge a highlight.

import type { NoteListItem } from "./note-input";

/** At most this many words are searched (the rest of the text is ignored). */
export const SEARCH_MAX_WORDS = 8;
/** A search needs at least this many letters or numbers in all (fewer: a neutral message). */
export const SEARCH_MIN_CHARACTERS = 2;
/** A longer word is searched by its first characters (still a prefix of the same word). */
export const SEARCH_WORD_MAX_LENGTH = 50;
/** `?q=` is read up to this length (a hand-written URL can't send a book). */
export const SEARCH_QUERY_MAX_LENGTH = 200;

/** The highlight markers of `ts_headline` (private use: never in a note, the server strips them). */
export const HEADLINE_OPEN = "\uE000";
export const HEADLINE_CLOSE = "\uE001";

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * The words to search: runs of letters and numbers of `text` (NFC, so an accent typed as a separate
 * mark joins its letter), at most 8, each cut at 50 characters. An empty list when the text has
 * fewer than 2 letters or numbers in all.
 */
export function searchWords(text: string): string[] {
  const words = (text.slice(0, SEARCH_QUERY_MAX_LENGTH).normalize("NFC").match(WORD) ?? [])
    .slice(0, SEARCH_MAX_WORDS)
    .map((word) => word.slice(0, SEARCH_WORD_MAX_LENGTH));
  const characters = words.reduce((sum, word) => sum + [...word].length, 0);
  return characters >= SEARCH_MIN_CHARACTERS ? words : [];
}

/** The `to_tsquery` operand of one word (a prefix). Only for `searchWords`' output. */
export function prefixOperand(word: string): string {
  return `${word}:*`;
}

/** `?q=` as the screen shows it: trimmed, cut at the maximum, "" when absent. */
export function searchTextFromParam(value: string | null): string {
  return (value ?? "").slice(0, SEARCH_QUERY_MAX_LENGTH).trim();
}

export type FragmentPart = { text: string; mark: boolean };

/** A search result: a list row with the body's best fragment instead of its first line. */
export type NoteSearchItem = NoteListItem & {
  /** The fragment, split at the highlights (empty when the body is). */
  fragment: FragmentPart[];
};

/** Markdown's line markers (titles, quotes, lists, task boxes) at the start of each line. */
const LINE_MARKERS =
  /(^|\n)[ \t]*(?:#{1,6}[ \t]+|>[ \t]*|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)*/g;

/** Emphasis and code characters go and spaces collapse (the fragment is one line of text). */
function plain(text: string): string {
  return text.replace(/[*_`~]+/g, "").replace(/\s+/g, " ");
}

/**
 * A `ts_headline` fragment as parts to draw: `mark` for the text between U+E000 and U+E001. A marker
 * that isn't closed marks to the end; a stray closing marker is dropped; nested openings count as
 * one. Markdown marks are removed, spaces collapsed and the ends trimmed; empty parts disappear.
 */
export function fragmentParts(fragment: string): FragmentPart[] {
  const parts: FragmentPart[] = [];
  let mark = false;
  let current = "";
  const push = () => {
    const text = plain(current);
    current = "";
    if (!text) return;
    const last = parts.at(-1);
    if (last && last.mark === mark) last.text = plain(last.text + text);
    else parts.push({ text, mark });
  };
  // The markers only wrap words, so line markers are found on the whole fragment first.
  for (const character of fragment.replace(LINE_MARKERS, "$1")) {
    if (character === HEADLINE_OPEN) {
      if (!mark) {
        push();
        mark = true;
      }
    } else if (character === HEADLINE_CLOSE) {
      if (mark) {
        push();
        mark = false;
      }
    } else {
      current += character;
    }
  }
  push();
  // Trim the ends (a mark keeps its text; only outer spaces go).
  if (parts.length > 0) {
    parts[0] = { ...parts[0], text: parts[0].text.trimStart() };
    const end = parts.length - 1;
    parts[end] = { ...parts[end], text: parts[end].text.trimEnd() };
  }
  return parts.filter((part) => part.text.length > 0);
}
