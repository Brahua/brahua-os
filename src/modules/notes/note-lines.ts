// Lines of a note (SPEC-notes "Línea → tarea", "Captura «Nota»"): pure and client-safe.
//
// - Task items are found exactly as the renderer finds them (src/lib/markdown/task-items.ts: the
//   same parser and the same order), so «Convertir en tarea» on the screen and the action on the
//   server mean the same item by its index. The server also checks the item's text: an index
//   that now points at another line is «Cambió mientras tanto».
// - Converting replaces `[ ] texto` with `[[task:<id>|texto]]` and keeps everything before it on
//   the line (indentation, `> `, the list marker), so the item stays where it was. Its «Deshacer»
//   puts `[ ] texto` back on that same line.
// - The capture appends `- HH:MM texto` (Lima's clock) at the end, after a line break when the
//   note has text; its «Deshacer» removes exactly what was appended.
import { formatNoteLink } from "@/lib/markdown/note-links";
import { parseTaskItems, splitLines, type MarkdownTaskItem } from "@/lib/markdown/task-items";
import { OWNER_TIME_ZONE } from "@/lib/time";

export type { MarkdownTaskItem } from "@/lib/markdown/task-items";

/** Every task item of `body`, in order (`text` is null for the ones that can't become a task). */
export function listTaskItems(body: string): MarkdownTaskItem[] {
  return parseTaskItems(body);
}

/**
 * The item `index` of `body` if it can become a task and still reads `text`; null otherwise (the
 * note changed since the screen showed it).
 */
export function findConvertibleItem(
  body: string,
  index: number,
  text: string,
): MarkdownTaskItem | null {
  const item = listTaskItems(body)[index];
  return item && item.text !== null && item.text === text ? item : null;
}

/** From the list marker on: the marker and its spaces (group 1), then the empty box. */
const OPEN_FROM_MARKER = /^((?:[-*+]|\d{1,9}[.)])[ \t]+)\[[ \t]\]/;

/** `body` with one line replaced (its line break kept). */
function replaceLine(body: string, line: number, next: (current: string) => string | null) {
  const { lines, starts } = splitLines(body);
  const current = lines[line];
  if (current === undefined) return null;
  const replaced = next(current);
  if (replaced === null) return null;
  return body.slice(0, starts[line]) + replaced + body.slice(starts[line] + current.length);
}

/**
 * `body` with the item's `[ ] texto` turned into `[[task:<id>|texto]]` (the name is its plain text, cleaned of
 * `[`, `]` and `|`). Null if the line no longer looks like that item.
 */
export function convertTaskItem(
  body: string,
  item: Pick<MarkdownTaskItem, "line" | "column" | "text" | "plain">,
  taskId: string,
): string | null {
  if (item.text === null || !item.plain) return null;
  const link = formatNoteLink("task", taskId, item.plain);
  return replaceLine(body, item.line, (current) => {
    const match = OPEN_FROM_MARKER.exec(current.slice(item.column));
    if (!match) return null;
    return current.slice(0, item.column) + match[1] + link;
  });
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An open item's rest of line after its prefix: the empty box and, optionally, its text. */
const OPEN_REST = /^\[[ \t]\](?:[ \t][^\r\n]*)?$/;

/**
 * «Deshacer» of a conversion: line `line` of `body` is again `original` (the line as it was) where
 * it held the link to `taskId` and only that after its list marker. `original` must be that same
 * line with `[ ] texto` in place of the link. Null if the line isn't the link anymore.
 */
export function restoreTaskItem(
  body: string,
  line: number,
  taskId: string,
  original: string,
): string | null {
  const pattern = new RegExp(
    `^(.*?(?:[-*+]|\\d{1,9}[.)])[ \\t]+)\\[\\[task:${escapeRegExp(taskId)}\\|[^\\[\\]|\\r\\n]+\\]\\]$`,
  );
  return replaceLine(body, line, (current) => {
    const prefix = pattern.exec(current)?.[1];
    if (prefix === undefined || !original.startsWith(prefix)) return null;
    return OPEN_REST.test(original.slice(prefix.length)) ? original : null;
  });
}

/** Line `line` of `body` as it is (no line break), or null. */
export function lineAt(body: string, line: number): string | null {
  return splitLines(body).lines[line] ?? null;
}

const CLOCK = new Intl.DateTimeFormat("es-PE", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: OWNER_TIME_ZONE,
});

/** Lima's clock at `now`: `HH:MM`, 24 hours (`00:05`, never `24:05`). */
export function limaClock(now: Date): string {
  const parts = Object.fromEntries(CLOCK.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}`;
}

/** The line the capture adds: `- HH:MM texto`. */
export function captureLine(now: Date, text: string): string {
  return `- ${limaClock(now)} ${text}`;
}

/**
 * `body` with `line` at its end: after a line break when the body has text that doesn't end with
 * one. `appended` is exactly what was added (its «Deshacer» removes it).
 */
export function appendLine(body: string, line: string): { body: string; appended: string } {
  const appended = body === "" || body.endsWith("\n") ? line : `\n${line}`;
  return { body: body + appended, appended };
}

/** `body` without `appended` at its end, or null if it doesn't end with it anymore. */
export function removeAppended(body: string, appended: string): string | null {
  return appended !== "" && body.endsWith(appended)
    ? body.slice(0, body.length - appended.length)
    : null;
}
