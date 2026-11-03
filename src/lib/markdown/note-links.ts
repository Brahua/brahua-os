// `[[type:uuid|Nombre]]` links of the notes (SPEC-notes "Enlaces"): pure and client-safe. The
// renderer (./markdown.tsx) and `notes` (the picker, backlinks, resolution) share this file.
//
// How a link reaches the page without the Markdown parser touching it:
// 1. Before parsing, `tokenizeNoteLinks` swaps every well-formed link in the source for a
//    placeholder: U+E010, a random nonce of this render, `:`, the index and U+E011. A name with
//    `<script>`, `*`, `_`, backticks or `|` can't turn into HTML, emphasis or a table cell: the
//    parser only sees the placeholder. The nonce keeps a note from forging one with HTML character
//    references (`&#xE010;…`, which the parser decodes into the same characters).
// 2. After parsing, `remarkNoteLinks` puts each link back: in plain text it becomes a link node
//    whose `href` the app builds from the type and the id (never from the text) with the
//    `data-note-link` marker; inside code (inline or block, its language and meta too), a URL or
//    raw HTML the original text comes back as it was written (a link in code doesn't count); inside
//    another link, just the name.
// 3. The sanitizer still runs after (it lets `data-note-link` through on `a`), and the `a`
//    component only treats as internal a marked link whose `href` passes `isNoteLinkHref`.
//
// A link escaped with a backslash (`\[[task:…|x]]`) is not a link: Markdown shows `[[task:…|x]]`.

export const NOTE_LINK_TYPES = ["note", "project", "task", "habit", "goal", "learning"] as const;
export type NoteLinkType = (typeof NOTE_LINK_TYPES)[number];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`);

/** A whole link: a known type, a lowercase uuid and a name without `[`, `]`, `|` or line breaks. */
const LINK_PATTERN = new RegExp(
  `\\[\\[(${NOTE_LINK_TYPES.join("|")}):(${UUID})\\|([^\\[\\]|\\r\\n]+)\\]\\]`,
  "g",
);

/** The routes a link may open: an entity's detail page (or a daily note's day). */
const NOTE_LINK_ROUTES: Record<NoteLinkType, string> = {
  note: "/notes",
  project: "/projects",
  task: "/tasks",
  habit: "/habits",
  goal: "/goals",
  learning: "/learning",
};

const HREF_PATTERN = new RegExp(
  `^/(?:(?:notes|projects|tasks|habits|goals|learning)/${UUID}|notes/\\d{4}-\\d{2}-\\d{2})$`,
);

export const NOTE_LINK_COPY = {
  gone: (name: string) => `${name} (ya no existe)`,
} as const;

export function isNoteLinkType(value: string): value is NoteLinkType {
  return (NOTE_LINK_TYPES as readonly string[]).includes(value);
}

export function isNoteLinkId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** The page a link opens, built by the app from the type and the id. */
export function noteLinkHref(type: NoteLinkType, id: string): string {
  return `${NOTE_LINK_ROUTES[type]}/${id}`;
}

/** Whether `href` is a route a note link may open (and nothing else: no host, query or path). */
export function isNoteLinkHref(href: string): boolean {
  return HREF_PATTERN.test(href);
}

/** The key of a link in a resolution map. */
export const noteLinkKey = (type: NoteLinkType, id: string) => `${type}:${id}`;

export type ParsedNoteLink = {
  type: NoteLinkType;
  id: string;
  /** The saved name (only a fallback: the current name comes from the resolution). */
  name: string;
  start: number;
  end: number;
};

/** Whether the character at `index` is escaped (an odd run of backslashes right before it). */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let at = index - 1; at >= 0 && text[at] === "\\"; at--) backslashes++;
  return backslashes % 2 === 1;
}

/**
 * Every well-formed link of `text`, in order (code included: this is the raw text). One escaped
 * with a backslash is not a link.
 */
export function parseNoteLinks(text: string): ParsedNoteLink[] {
  const links: ParsedNoteLink[] = [];
  for (const match of text.matchAll(LINK_PATTERN)) {
    const name = match[3].trim();
    if (name === "" || isEscaped(text, match.index)) continue;
    links.push({
      type: match[1] as NoteLinkType,
      id: match[2],
      name,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return links;
}

/** The ids each type needs resolved for `text` (one query per type present). */
export function noteLinkIdsByType(text: string): Map<NoteLinkType, string[]> {
  const byType = new Map<NoteLinkType, Set<string>>();
  for (const { type, id } of parseNoteLinks(text)) {
    const ids = byType.get(type) ?? new Set<string>();
    ids.add(id);
    byType.set(type, ids);
  }
  return new Map([...byType].map(([type, ids]) => [type, [...ids]]));
}

/** A name as it can be saved inside a link: no `[`, `]`, `|`, line breaks or extra spaces. */
export function cleanNoteLinkName(name: string): string {
  return name
    .replace(/[[\]|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The text of a link (the picker inserts it). An empty name becomes «…». */
export function formatNoteLink(type: NoteLinkType, id: string, name: string): string {
  return `[[${type}:${id}|${cleanNoteLinkName(name) || "…"}]]`;
}

/** What the server knows of a link's target (SPEC-notes "Fuentes de enlace", `resolve`). */
export type ResolvedNoteLink = {
  name: string;
  href: string;
  deleted: boolean;
  /** Tasks only (N3's checkbox). */
  done?: boolean;
};

/** Resolutions by `noteLinkKey`. A plain object (it crosses from the page to the client editor). */
export type NoteLinkResolutions = Readonly<Record<string, ResolvedNoteLink>>;

/**
 * What a link missing from the resolutions means: `"deleted"` when the server resolved exactly this
 * text (it looked and found nothing: drawn as gone), `"saved"` when the text may have links the
 * server never looked at (the editor's text: drawn as a link with its saved name).
 */
export type UnknownNoteLinks = "deleted" | "saved";

/** How one link renders: a link (name, href) or plain text (a target that is gone). */
export type NoteLinkView =
  { kind: "link"; name: string; href: string } | { kind: "gone"; text: string };

export function noteLinkView(
  link: Pick<ParsedNoteLink, "type" | "id" | "name">,
  resolutions: NoteLinkResolutions | undefined,
  unknown: UnknownNoteLinks = "saved",
): NoteLinkView {
  const fallbackHref = noteLinkHref(link.type, link.id);
  const key = noteLinkKey(link.type, link.id);
  const resolved = resolutions && Object.hasOwn(resolutions, key) ? resolutions[key] : undefined;
  if (!resolved) {
    return unknown === "deleted" && resolutions
      ? { kind: "gone", text: NOTE_LINK_COPY.gone(link.name) }
      : { kind: "link", name: link.name, href: fallbackHref };
  }
  const name = cleanNoteLinkName(resolved.name) || link.name;
  if (resolved.deleted) return { kind: "gone", text: NOTE_LINK_COPY.gone(name) };
  return {
    kind: "link",
    name,
    href: isNoteLinkHref(resolved.href) ? resolved.href : fallbackHref,
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering (steps 1 and 2 of the header).

const OPEN = "\uE010";
const CLOSE = "\uE011";

/** A random nonce for one render (a non-secure context has no `randomUUID`). */
function newNonce(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return (uuid ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 8);
}

export type TokenizedNoteLinks = {
  source: string;
  links: ParsedNoteLink[];
  raws: string[];
  /** Finds this render's placeholders (group 1: the index). */
  placeholder: RegExp;
};

/** Step 1: the source with every link swapped for a placeholder (and the links, by index). */
export function tokenizeNoteLinks(text: string, nonce: string = newNonce()): TokenizedNoteLinks {
  // Placeholder characters typed as such mean nothing: they go.
  const clean = text.replace(/[\uE010\uE011]/g, "");
  const safeNonce = nonce.replace(/[^0-9a-z]/gi, "");
  const placeholder = new RegExp(`\\uE010${safeNonce}:(\\d+)\\uE011`, "g");
  const links = parseNoteLinks(clean);
  if (links.length === 0) return { source: clean, links, raws: [], placeholder };
  const raws: string[] = [];
  let source = "";
  let at = 0;
  links.forEach((link, index) => {
    source += clean.slice(at, link.start) + `${OPEN}${safeNonce}:${index}${CLOSE}`;
    raws.push(clean.slice(link.start, link.end));
    at = link.end;
  });
  return { source: source + clean.slice(at), links, raws, placeholder };
}

type RemarkNoteLinksOptions = {
  tokens: TokenizedNoteLinks;
  resolutions?: NoteLinkResolutions;
  unknown?: UnknownNoteLinks;
};

const INSIDE_LINK = new Set(["link", "linkReference"]);
/** String fields restored as written (every one but a text's value). */
const RAW_FIELDS = ["value", "url", "title", "alt", "label", "lang", "meta"];

// The few mdast shapes this plugin touches (`@types/mdast` isn't a direct dependency).
type MdNode = { type: string; children?: MdNode[]; [field: string]: unknown };
type MdText = MdNode & { type: "text"; value: string };
const isText = (node: MdNode): node is MdText =>
  node.type === "text" && typeof node.value === "string";

/** Step 2: a remark plugin that puts the links back (see the header). */
export function remarkNoteLinks({ tokens, resolutions, unknown }: RemarkNoteLinksOptions) {
  const pattern = () => new RegExp(tokens.placeholder.source, "g");
  const restore = (value: string) =>
    value.replace(pattern(), (_whole, index: string) => tokens.raws[Number(index)] ?? "");

  function splitText(node: MdText, insideLink: boolean): MdNode[] {
    const parts: MdNode[] = [];
    let at = 0;
    for (const match of node.value.matchAll(pattern())) {
      if (match.index > at) parts.push({ type: "text", value: node.value.slice(at, match.index) });
      at = match.index + match[0].length;
      const link = tokens.links[Number(match[1])];
      if (!link) continue;
      const view = noteLinkView(link, resolutions, unknown);
      if (view.kind === "gone") {
        // Muted, as text (`span` keeps no attribute through the sanitizer: the class comes from
        // the `span` component, which only styles spans marked this way).
        parts.push({
          type: "emphasis",
          children: [{ type: "text", value: view.text }],
          data: { hName: "span", hProperties: { dataNoteLinkGone: "" } },
        });
      } else if (insideLink) parts.push({ type: "text", value: view.name });
      else {
        parts.push({
          type: "link",
          url: view.href,
          title: null,
          children: [{ type: "text", value: view.name }],
          data: { hProperties: { dataNoteLink: link.type } },
        });
      }
    }
    if (at < node.value.length) parts.push({ type: "text", value: node.value.slice(at) });
    return parts;
  }

  function visit(node: MdNode, insideLink: boolean) {
    for (const field of RAW_FIELDS) {
      if (node.type === "text" && field === "value") continue;
      const value = node[field];
      if (typeof value === "string" && value.includes(OPEN)) node[field] = restore(value);
    }
    if (!Array.isArray(node.children)) return;
    const inside = insideLink || INSIDE_LINK.has(node.type);
    node.children = node.children.flatMap((child) => {
      if (isText(child) && child.value.includes(OPEN)) return splitText(child, inside);
      visit(child, inside);
      return [child];
    });
  }

  return (tree: MdNode) => {
    if (tokens.links.length > 0) visit(tree, false);
  };
}
