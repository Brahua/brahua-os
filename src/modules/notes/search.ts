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
/** A search needs at least one word this long (shorter words go when a longer one is there). */
export const SEARCH_MIN_WORD_LENGTH = 2;
/** A longer word is searched by its first characters (still a prefix of the same word). */
export const SEARCH_WORD_MAX_LENGTH = 50;
/** `?q=` is read up to this length (a hand-written URL can't send a book). */
export const SEARCH_QUERY_MAX_LENGTH = 200;
/**
 * The most results a search returns, whatever `?n=` asks (each row costs a `ts_headline` over the
 * body): ten pages of the list. Past it «Ver más» doesn't show; a narrower search finds the rest.
 */
export const SEARCH_MAX_SHOWN = 300;

/** The highlight markers of `ts_headline` (private use: never in a note, the server strips them). */
export const HEADLINE_OPEN = "\uE000";
export const HEADLINE_CLOSE = "\uE001";

const WORD = /[\p{L}\p{N}]+/gu;
/** What a word sent to Postgres must be (search-data.ts checks it again before every query). */
export const SEARCH_WORD_PATTERN = /^[\p{L}\p{N}]{1,50}$/u;

const length = (word: string) => [...word].length;

/**
 * The words to search: runs of letters and numbers of `text` (NFC, so an accent typed as a separate
 * mark joins its letter), each cut at 50 characters. One-letter words go when a longer one is
 * there (a one-letter prefix matches almost everything), and at least one word of 2 or more is
 * needed: «a b» is no search. At most 8.
 */
export function searchWords(text: string): string[] {
  const words = (text.slice(0, SEARCH_QUERY_MAX_LENGTH).normalize("NFC").match(WORD) ?? []).map(
    (word) => [...word].slice(0, SEARCH_WORD_MAX_LENGTH).join(""),
  );
  const long = words.filter((word) => length(word) >= SEARCH_MIN_WORD_LENGTH);
  return long.slice(0, SEARCH_MAX_WORDS);
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
  /** The fragment leaves out text at the start or at the end of the body («…»). */
  cutStart: boolean;
  cutEnd: boolean;
};

/** Markdown's line markers (titles, quotes, lists, task boxes) at the start of each line. */
const LINE_MARKERS =
  /(^|\n)[ \t]*(?:#{1,6}[ \t]+|>[ \t]*|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)*/g;

/**
 * Markdown's inline markup, removed where it is markup: a link or image `[texto](url)` shows only
 * `texto`; inline code, strong, emphasis and strikethrough keep their text. A lone `*`, `_`, `` ` ``
 * or `~` (a fragment cut in the middle of an emphasis, `snake_case`, `2 * 3`) stays as written.
 * The highlight markers only wrap words, so they survive inside the markup.
 */
function withoutMarkup(text: string): string {
  return text
    .replace(/!?\[([^\]\n]*)\]\([^)\s]*(?:\s+"[^"\n]*")?\)/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/~~(?=\S)([^\n~]*?\S)~~/g, "$1")
    .replace(/\*(?=[^\s*])([^\n*]*?[^\s*])\*/g, "$1")
    .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([^\n_]*?[^\s_])_(?![\p{L}\p{N}_])/gu, "$1$2");
}

/** Spaces collapse (the fragment is one line of text). */
function plain(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * A `ts_headline` fragment as parts to draw: `mark` for the text between U+E000 and U+E001. A marker
 * that isn't closed marks to the end; a stray closing marker is dropped; nested openings count as
 * one. Markdown markup is removed, spaces collapsed and the ends trimmed; empty parts disappear.
 */
export function fragmentParts(fragment: string): FragmentPart[] {
  const parts: FragmentPart[] = [];
  let mark = false;
  let current = "";
  const push = () => {
    const text = plain(current);
    current = "";
    if (!text) return;
    // A mark of only spaces marks nothing: it is plain text.
    const marked = mark && text.trim() !== "";
    const last = parts.at(-1);
    if (last && last.mark === marked) last.text = plain(last.text + text);
    else parts.push({ text, mark: marked });
  };
  // The markers only wrap words, so line markers and markup are found on the whole fragment first.
  for (const character of withoutMarkup(fragment.replace(LINE_MARKERS, "$1"))) {
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
