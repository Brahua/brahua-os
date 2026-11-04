// N4: the search inside Notas (SPEC-notes "Búsqueda"), the data half (server only). Callers check
// the owner first (queries.ts → searchNotes). The words come from `searchWords` (search.ts): only
// letters and numbers, each sent as its own bound parameter, never as tsquery syntax.
//
// The column `notes.search` and its GIN index exist only in migration 0028 (not in the Drizzle
// schema, so nothing else selects or exports them). It holds the title (weight A) and the body with
// each link replaced by its name (weight B), each twice: `notes_spanish` (stems, without accents)
// and `notes_simple` (whole words, without accents). A query word is a prefix in both, OR-ed, and
// the words are AND-ed: «polit» finds «políticas» (stem 'polit') and «comunicac» finds
// «comunicaciones» (the stem 'comun' would not start with it).
import "server-only";
import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { notes } from "./db/schema";
import type { NoteKindFilter } from "./note-input";
import {
  fragmentParts,
  HEADLINE_CLOSE,
  HEADLINE_OPEN,
  prefixOperand,
  type NoteSearchItem,
} from "./search";

/** The same link pattern as the generated column (migration 0028) and note-links.ts. */
const LINK_PATTERN =
  "\\[\\[(note|project|task|habit|goal|learning):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\|([^][|\\r\\n]+)\\]\\]";

/** `ts_headline` options: one fragment of 8–20 words, our own markers instead of `<b>`. */
const HEADLINE_OPTIONS = `StartSel=${HEADLINE_OPEN},StopSel=${HEADLINE_CLOSE},MaxFragments=1,MaxWords=20,MinWords=8`;

/** The search column, qualified by hand (it isn't in the Drizzle schema). */
const searchColumn = sql`"notes"."search"`;

/**
 * The tsquery of some words: `(spanish(w:*) || simple(w:*))` per word, joined with `&&`. Each word
 * is a bound parameter; a word that is only a Spanish stop word («de») still has its simple half.
 */
export function wordsQuery(words: readonly string[]): SQL {
  return sql.join(
    words.map(
      (word) =>
        sql`(to_tsquery('notes_spanish'::regconfig, ${prefixOperand(word)}) || to_tsquery('notes_simple'::regconfig, ${prefixOperand(word)}))`,
    ),
    sql` && `,
  );
}

/**
 * The body as the headline reads it: links replaced by their names (as in the column) and the
 * highlight markers removed (a note can't forge a highlight).
 */
const headlineBody = sql`translate(regexp_replace(${notes.body}, ${LINK_PATTERN}, ${"\\2"}, 'g'), ${HEADLINE_OPEN + HEADLINE_CLOSE}, '')`;

/**
 * Live notes matching every word, best first (`ts_rank`: the title weighs more than the body), then
 * by last edit; with the list's kind and area filters. At most `limit`, and whether there are more.
 * `words` must come from `searchWords` (non-empty).
 */
export async function selectNoteSearch(
  db: Database,
  {
    words,
    kind,
    areaId,
    limit,
  }: { words: readonly string[]; kind: NoteKindFilter; areaId: string | null; limit: number },
): Promise<{ items: NoteSearchItem[]; more: boolean }> {
  if (words.length === 0) return { items: [], more: false };
  const query = wordsQuery(words);
  // The GIN index finds the rows; Postgres computes the (costly) headline after the sort and the
  // limit, only for the rows returned.
  const rows = await db
    .select({
      id: notes.id,
      kind: notes.kind,
      day: notes.day,
      title: notes.title,
      pinnedAt: notes.pinnedAt,
      updatedAt: notes.updatedAt,
      areaName: lifeAreas.name,
      fragment: sql<string>`ts_headline('notes_simple'::regconfig, ${headlineBody}, (${query}), ${HEADLINE_OPTIONS})`,
    })
    .from(notes)
    .leftJoin(lifeAreas, eq(lifeAreas.id, notes.areaId))
    .where(
      and(
        isNull(notes.deletedAt),
        sql`${searchColumn} @@ (${query})`,
        kind === "all" ? undefined : eq(notes.kind, kind),
        areaId === null ? undefined : eq(notes.areaId, areaId),
      ),
    )
    .orderBy(sql`ts_rank(${searchColumn}, (${query})) desc`, desc(notes.updatedAt), asc(notes.id))
    .limit(limit + 1);
  return {
    more: rows.length > limit,
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      kind: row.kind,
      day: row.day,
      title: row.title,
      excerpt: "",
      fragment: fragmentParts(row.fragment ?? ""),
      pinned: row.pinnedAt !== null,
      editedOn: ownerDateKey(row.updatedAt),
      areaName: row.areaName,
    })),
  };
}
