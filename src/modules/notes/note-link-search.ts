// The `[[` picker's pure side (SPEC-notes "Selector `[[`"), client-safe: the `[[` being typed before
// the cursor (`findLinkQuery`), choosing a result (`insertLink`), and how notes are found
// (`parseDayQuery`). A knowledge note is found by its title; a daily note (no title) by its day,
// written either way:
// - ISO, whole or a prefix: `2026-11-03`, `2026-11` (every day of that month), `2026`; a one-digit
//   month or day is that one (`2026-11-3` = the 3rd).
// - Day and month in Spanish, with an optional year: `3 nov`, `3 de noviembre`, `03 nov. 2026`.
//   The month needs its first three letters (`sep` and `set` both work); without a year, every
//   year matches (most recent first).
import { formatNoteLink, type NoteLinkType } from "@/lib/markdown/note-links";
import { foldSearchText } from "@/lib/text";
import { NOTE_LINK_OPEN_MAX_LENGTH } from "./note-constants";

/** What the owner is typing after `[[`: where the `[[` starts and the text after it. */
export type LinkQuery = { start: number; query: string };

/**
 * The `[[` being typed right before the cursor (SPEC-notes "Selector `[[`"), or null when:
 * - the text after the last `[[` before `caret` has a `[`, `]`, `|` or line break (a finished link
 *   before the cursor);
 * - the rest of the line after the cursor reaches a `|` or `]]` before another `[[` (the cursor is
 *   inside a link already written: Enter or Tab must not break it);
 * - it has no letter that isn't a space, a double space, or more than NOTE_LINK_OPEN_MAX_LENGTH
 *   characters (a `[[` left open earlier in the line, «ver [[ luego…», stops searching: names are
 *   short, and two spaces read as «I moved on»).
 */
export function findLinkQuery(text: string, caret: number): LinkQuery | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("[[");
  if (start === -1) return null;
  const query = before.slice(start + 2);
  if (/[[\]|\r\n]/.test(query)) return null;
  if (query.trim() === "" || query.includes("  ") || query.length > NOTE_LINK_OPEN_MAX_LENGTH) {
    return null;
  }
  const lineAfter = text.slice(caret).split(/\r?\n/, 1)[0];
  const ends = /\[\[|\||\]\]/.exec(lineAfter);
  if (ends && ends[0] !== "[[") return null;
  return { start, query };
}

/**
 * Choosing a result: `[[texto` (from `query.start` to `caret`) becomes the whole link, and the
 * cursor goes right after it.
 */
export function insertLink(
  text: string,
  { start }: LinkQuery,
  caret: number,
  target: { type: NoteLinkType; id: string; name: string },
): { text: string; caret: number } {
  const link = formatNoteLink(target.type, target.id, target.name);
  return { text: text.slice(0, start) + link + text.slice(caret), caret: start + link.length };
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export type DayQuery =
  | { kind: "iso"; prefix: string }
  | { kind: "dayMonth"; day: number; month: number; year: number | null };

const ISO_PREFIX = /^\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?-?$/;
const DAY_MONTH = /^(\d{1,2})\s+(?:de\s+)?([a-z]{3,})\.?(?:\s+(?:de\s+)?(\d{4}))?$/;

/**
 * The day a query names, or null when it isn't a day (then only titles are searched). In ISO, a
 * month or day written with one digit means exactly that one (`2026-11-3` is the 3rd, never the
 * 30th or 31st; `2026-1` is January): it is padded with a zero.
 */
export function parseDayQuery(text: string): DayQuery | null {
  const q = foldSearchText(text);
  if (ISO_PREFIX.test(q)) {
    const prefix = q
      .split("-")
      .map((part, index) => (index > 0 && part.length === 1 ? `0${part}` : part))
      .join("-");
    return { kind: "iso", prefix };
  }
  const match = DAY_MONTH.exec(q);
  if (!match) return null;
  const day = Number(match[1]);
  const word = match[2] === "set" || match[2].startsWith("setiembre") ? "sep" : match[2];
  const month = MONTHS.findIndex((name) => word.startsWith(name)) + 1;
  if (month === 0 || day < 1 || day > 31) return null;
  return { kind: "dayMonth", day, month, year: match[3] ? Number(match[3]) : null };
}
