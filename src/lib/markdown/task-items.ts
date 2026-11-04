// Task list items of a Markdown text (SPEC-notes "Línea → tarea", "Casilla de tarea"): pure and
// client-safe. ONE definition of which items exist and their order, shared by the renderer
// (./markdown.tsx, which marks each item while it renders) and by `notes` (note-lines.ts, which
// finds an item by its index in the stored text to replace its line). Both read the same syntax
// tree from the same parser (react-markdown's remark with remark-gfm), so an index means the same
// item on the screen and on the server; code blocks, HTML and anything that isn't a list item
// never count.
//
// - A **task item** is a GFM task list item (`- [ ] texto`, `- [x] texto`; any list marker, any
//   depth, inside quotes too). `index` is its position among the task items of the text, in
//   document order. It can become a task (`text` not null) when it is unchecked, its text sits on
//   the marker's line alone (no lazy continuation) and holds no `[[…]]` link.
// - A **linked item** is a list item (not a GFM task item) whose text starts with a
//   `[[task:<id>|Nombre]]` link: the renderer draws the task's real checkbox before it.
//
// The parse runs on the text with its links swapped for placeholders (note-links.ts,
// `tokenizeNoteLinks`), as the renderer does. Placeholders and links hold no line breaks, so line
// numbers are the same in both texts; a line that can become a task holds no placeholder, so its
// characters are the same too.
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { tokenizeNoteLinks, type TokenizedNoteLinks } from "./note-links";

export type MarkdownTaskItem = {
  /** Position among the task items of the text (0-based, document order). */
  index: number;
  checked: boolean;
  /** 0-based line of the item's marker. */
  line: number;
  /** Offset of the marker inside its line (characters). */
  column: number;
  /** The text after `[ ]`, trimmed, when the item can become a task; else null. */
  text: string | null;
};

export type MarkdownLinkedItem = {
  /** Index of the leading link in `tokens.links`. */
  link: number;
};

// The few mdast shapes read here (`@types/mdast` isn't a direct dependency).
type Point = { line: number; column: number; offset?: number };
type MdNode = {
  type: string;
  checked?: boolean | null;
  value?: string;
  children?: MdNode[];
  position?: { start: Point; end: Point };
  data?: Record<string, unknown>;
};

/** Line breaks as micromark reads them: `\r\n`, `\r` or `\n`. */
const LINE_BREAK = /\r\n|\r|\n/;

/** `- [ ] texto` from the marker on: the marker, its spaces, an empty box and the text. */
const OPEN_ITEM = /^(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ \t]\](?:[ \t]+(.*))?$/;

/** The lines of `text` and the offset where each one starts. */
export function splitLines(text: string): { lines: string[]; starts: number[] } {
  const lines: string[] = [];
  const starts: number[] = [];
  let at = 0;
  for (;;) {
    const rest = text.slice(at);
    const match = LINE_BREAK.exec(rest);
    starts.push(at);
    if (!match) {
      lines.push(rest);
      return { lines, starts };
    }
    lines.push(rest.slice(0, match.index));
    at += match.index + match[0].length;
  }
}

export type CollectedTaskItems = {
  tasks: (MarkdownTaskItem & { node: MdNode })[];
  linked: (MarkdownLinkedItem & { node: MdNode })[];
};

/**
 * The task items and linked items of a parsed tree (`source` is the text it was parsed from, with
 * its link placeholders; `tokens` finds them).
 */
export function collectTaskItems(
  tree: MdNode,
  source: string,
  tokens: Pick<TokenizedNoteLinks, "links" | "placeholder">,
  /** False when the original text held placeholder characters (`hasPlaceholderCharacters`). */
  convertible: boolean,
): CollectedTaskItems {
  const { lines, starts } = splitLines(source);
  const found: CollectedTaskItems = { tasks: [], linked: [] };
  const placeholderAt = (value: string) => new RegExp(`^${tokens.placeholder.source}`).exec(value);

  function visit(node: MdNode) {
    if (node.type === "listItem" && node.position) {
      const line = node.position.start.line - 1;
      const column = (node.position.start.offset ?? 0) - (starts[line] ?? 0);
      const paragraph = node.children?.[0];
      if (typeof node.checked === "boolean") {
        found.tasks.push({
          index: found.tasks.length,
          checked: node.checked,
          line,
          column,
          text:
            node.checked || !convertible
              ? null
              : openText(lines[line] ?? "", column, paragraph, line),
          node,
        });
      } else if (paragraph?.type === "paragraph") {
        const first = paragraph.children?.[0];
        const match = first?.type === "text" ? placeholderAt(first.value ?? "") : null;
        const link = match ? Number(match[1]) : -1;
        if (tokens.links[link]?.type === "task") found.linked.push({ link, node });
      }
    }
    node.children?.forEach(visit);
  }

  visit(tree);
  return found;
}

/** The text of an unchecked item that can become a task, or null (see the header). */
function openText(
  line: string,
  column: number,
  paragraph: MdNode | undefined,
  lineIndex: number,
): string | null {
  if (paragraph?.type !== "paragraph" || !paragraph.position) return null;
  // The text must end on the marker's line (no lazy continuation).
  if (paragraph.position.end.line - 1 !== lineIndex) return null;
  // A link (its placeholder) anywhere on the line: not a plain line.
  if (/[\uE010\uE011]/.test(line)) return null;
  const match = OPEN_ITEM.exec(line.slice(column));
  const text = match?.[1]?.trim() ?? "";
  return text === "" ? null : text;
}

/**
 * Whether `text` holds the placeholder characters themselves: then no item can become a task (the
 * parsed lines lose them and wouldn't match the stored text character for character).
 */
export function hasPlaceholderCharacters(text: string): boolean {
  return /[\uE010\uE011]/.test(text);
}

/** A fixed nonce for parses that never render (the placeholders never leave this file). */
const PARSE_NONCE = "parse";

/**
 * The task items of `text` as the renderer sees them (same parser, same link placeholders). A text
 * holding the placeholder characters themselves has no item that can become a task.
 */
export function parseTaskItems(text: string): MarkdownTaskItem[] {
  const tokens = tokenizeNoteLinks(text, PARSE_NONCE);
  let collected: CollectedTaskItems = { tasks: [], linked: [] };
  function collect() {
    return (tree: MdNode) => {
      collected = collectTaskItems(tree, tokens.source, tokens, !hasPlaceholderCharacters(text));
      // Nothing to render: the tree is emptied once read.
      tree.children = [];
    };
  }
  // react-markdown's own processor (parse and run, synchronously); its output is discarded.
  Markdown({ children: tokens.source, remarkPlugins: [remarkGfm, collect] });
  return collected.tasks.map(({ index, checked, line, column, text: itemText }) => ({
    index,
    checked,
    line,
    column,
    text: itemText,
  })) satisfies MarkdownTaskItem[];
}

// ---------------------------------------------------------------------------------------------
// The renderer's side (./markdown.tsx).

/** What the renderer draws next to an item, by the `data-md-item` mark it put on the `li`. */
export type TaskItemMark =
  | { kind: "open"; index: number; text: string }
  | {
      kind: "linked";
      /** The task's id. */
      id: string;
      /** The name the link shows (current, or the saved one). */
      name: string;
      /** The task's state when the server resolved it; null when nobody looked it up yet. */
      done: boolean | null;
      /** The task is gone (deleted, or not found by the server's resolution). */
      gone: boolean;
    };

export type LinkedTaskState = Omit<Extract<TaskItemMark, { kind: "linked" }>, "kind" | "id">;

type RemarkTaskItemsOptions = {
  tokens: TokenizedNoteLinks;
  convertible: boolean;
  /** How a linked item's task reads now: its name, state and whether it is gone. */
  describe: (link: TokenizedNoteLinks["links"][number]) => LinkedTaskState;
  /** Filled while parsing: the marks, by the number put on each `li`. */
  marks: TaskItemMark[];
};

/**
 * A remark plugin (after remark-gfm, before the links are put back): marks every task item that
 * can become a task, and every item that starts with a task link, with `data-md-item` (a number
 * into `marks`; the sanitizer lets only digits through).
 */
export function remarkTaskItems({ tokens, convertible, describe, marks }: RemarkTaskItemsOptions) {
  return (tree: MdNode) => {
    const { tasks, linked } = collectTaskItems(tree, tokens.source, tokens, convertible);
    const mark = (node: MdNode, value: TaskItemMark) => {
      const data = (node.data ??= {});
      const properties = (data.hProperties ?? {}) as Record<string, unknown>;
      data.hProperties = { ...properties, dataMdItem: String(marks.length) };
      marks.push(value);
    };
    for (const item of tasks) {
      if (item.text !== null) mark(item.node, { kind: "open", index: item.index, text: item.text });
    }
    for (const item of linked) {
      const link = tokens.links[item.link];
      mark(item.node, { kind: "linked", id: link.id, ...describe(link) });
    }
  };
}
