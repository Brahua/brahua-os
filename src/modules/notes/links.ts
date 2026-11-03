// `[[…]]` links of the notes, on the server (SPEC-notes "Enlaces", "Backlinks"): the notes' own link
// source (search and resolve), the search across every source for the picker, the resolution of a
// note's links (one query per type present) and the backlinks. Server only; the callers checked the
// owner. The sources come in as an argument: `notes` never imports the modules it links to (the
// composition root src/lib/note-link-sources.ts names them).
import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { escapeLike, nameContains, prefixRank } from "@/lib/link-search";
import {
  isNoteLinkId,
  isNoteLinkType,
  noteLinkIdsByType,
  noteLinkKey,
  type NoteLinkResolutions,
  type NoteLinkType,
} from "@/lib/markdown/note-links";
import type { NoteLinkCandidate, NoteLinkGroup, NoteLinkSource, NoteLinkTarget } from "./contracts";
import { NOTES_COPY as COPY } from "./copy";
import { notes } from "./db/schema";
import { NOTE_LINK_RESULTS_MAX } from "./note-constants";
import { dailyTitle } from "./note-day";
import { parseDayQuery } from "./note-link-search";
import { notePath } from "./routes";

const live = isNull(notes.deletedAt);

/** A note's name in a link or a list: its title, or the long date of a daily note. */
function noteName(row: { kind: string; day: string | null; title: string | null }, today: string) {
  return row.kind === "daily" && row.day ? dailyTitle(row.day, today) : (row.title ?? "");
}

/** A note's page: a daily note opens its day (its id isn't a route), a knowledge note its id. */
function noteHref(row: { id: string; kind: string; day: string | null }) {
  return notePath(row.kind === "daily" && row.day ? row.day : row.id);
}

function dayCondition(text: string): SQL | null {
  const query = parseDayQuery(text);
  if (!query) return null;
  if (query.kind === "iso") {
    return sql`to_char(${notes.day}, 'YYYY-MM-DD') like ${`${escapeLike(query.prefix)}%`}`;
  }
  return and(
    sql`extract(day from ${notes.day}) = ${query.day}`,
    sql`extract(month from ${notes.day}) = ${query.month}`,
    query.year === null ? undefined : sql`extract(year from ${notes.day}) = ${query.year}`,
  )!;
}

/**
 * The notes' own source: knowledge notes by title (pinned first, then prefixes) and, when the text
 * names a day (`note-link-search.ts`), daily notes of that day (most recent first, before titles).
 */
export async function searchNoteLinkTargets(
  db: Database,
  q: string,
  limit: number,
  today: string,
): Promise<NoteLinkCandidate[]> {
  const byDay = dayCondition(q);
  const [days, pages] = await Promise.all([
    byDay
      ? db
          .select({ id: notes.id, kind: notes.kind, day: notes.day, title: notes.title })
          .from(notes)
          .where(and(live, eq(notes.kind, "daily"), byDay))
          .orderBy(desc(notes.day))
          .limit(limit)
      : Promise.resolve([]),
    db
      .select({ id: notes.id, kind: notes.kind, day: notes.day, title: notes.title })
      .from(notes)
      .where(and(live, eq(notes.kind, "page"), nameContains(notes.title, q)))
      .orderBy(
        sql`${notes.pinnedAt} is null`,
        prefixRank(notes.title, q),
        asc(notes.title),
        asc(notes.id),
      )
      .limit(limit),
  ]);
  return [...days, ...pages].slice(0, limit).map((row) => ({
    id: row.id,
    name: noteName(row, today),
    hint: row.kind === "daily" ? COPY.linkDailyHint : null,
  }));
}

/** The notes behind `ids` (deleted ones too, marked), with their name and page. */
export async function resolveNoteLinkTargets(
  db: Database,
  ids: readonly string[],
  today: string,
): Promise<NoteLinkTarget[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: notes.id,
      kind: notes.kind,
      day: notes.day,
      title: notes.title,
      deletedAt: notes.deletedAt,
    })
    .from(notes)
    .where(inArray(notes.id, [...ids]));
  return rows.map((row) => ({
    id: row.id,
    name: noteName(row, today),
    href: noteHref(row),
    deleted: row.deletedAt !== null,
  }));
}

/**
 * The picker's results for `q` (SPEC-notes "Selector `[[`"): every source searched at once, at most
 * NOTE_LINK_RESULTS_MAX in all, taken in turns across the types (so one type can't fill the list),
 * then grouped by type in the sources' order. Blank text: nothing.
 */
export async function searchLinkTargets(
  db: Database,
  sources: readonly NoteLinkSource[],
  q: string,
): Promise<NoteLinkGroup[]> {
  if (q.trim() === "") return [];
  const max = NOTE_LINK_RESULTS_MAX;
  const results = await Promise.all(sources.map((source) => source.search(db, q, max)));
  const taken = results.map(() => 0);
  let total = 0;
  for (let round = 0; round < max && total < max; round++) {
    let any = false;
    results.forEach((items, index) => {
      if (total < max && round < items.length) {
        taken[index]++;
        total++;
        any = true;
      }
    });
    if (!any) break;
  }
  return sources
    .map((source, index) => ({
      type: source.type,
      label: source.label,
      items: results[index].slice(0, taken[index]).map((item) => ({
        id: item.id,
        name: item.name,
        hint: item.hint ?? null,
      })),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * What a note's links point to now (current names, deleted targets, tasks' state): one query per
 * type present in `body`, all at once. A type without a source resolves nothing (drawn deleted).
 */
export async function resolveLinks(
  db: Database,
  sources: readonly NoteLinkSource[],
  body: string,
): Promise<NoteLinkResolutions> {
  const byType = noteLinkIdsByType(body);
  if (byType.size === 0) return {};
  const resolved = await Promise.all(
    [...byType].map(async ([type, ids]) => {
      const source = sources.find((candidate) => candidate.type === type);
      return source ? { type, targets: await source.resolve(db, ids) } : { type, targets: [] };
    }),
  );
  const resolutions: Record<string, NoteLinkResolutions[string]> = {};
  for (const { type, targets } of resolved) {
    for (const target of targets) {
      resolutions[noteLinkKey(type, target.id)] = {
        name: target.name,
        href: target.href,
        deleted: target.deleted,
        ...(target.done === undefined ? {} : { done: target.done }),
      };
    }
  }
  return resolutions;
}

/** A note that links to something: what «Enlazada desde» and «Mencionado en» list. */
export type LinkingNote = { id: string; name: string; href: string; kind: "daily" | "page" };

/**
 * Live notes whose body links to `type`/`id` (`[[type:<id>|`), most recently edited first, except
 * `excludeId` (a note linking to itself isn't a backlink). Computed on read with LIKE: the type and
 * the id are validated (a uuid), so no wildcard of the owner's reaches the pattern. Nothing for an
 * invalid pair.
 */
export async function selectLinkingNotes(
  db: Database,
  type: NoteLinkType,
  id: string,
  today: string,
  excludeId: string | null = null,
): Promise<LinkingNote[]> {
  if (!isNoteLinkType(type) || !isNoteLinkId(id)) return [];
  const pattern = `%${escapeLike(`[[${type}:${id}|`)}%`;
  const rows = await db
    .select({ id: notes.id, kind: notes.kind, day: notes.day, title: notes.title })
    .from(notes)
    .where(
      and(
        live,
        sql`${notes.body} like ${pattern}`,
        excludeId ? ne(notes.id, excludeId) : undefined,
      ),
    )
    .orderBy(desc(notes.updatedAt), asc(notes.id));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: noteName(row, today),
    href: noteHref(row),
  }));
}
