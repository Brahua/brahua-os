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
  SEARCH_WORD_PATTERN,
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
 * Every word must be letters and numbers only (1–50): anything else throws, without the text, so
 * no caller can ever hand tsquery syntax to Postgres.
 */
export function wordsQuery(words: readonly string[]): SQL {
  if (words.length === 0 || !words.every((word) => SEARCH_WORD_PATTERN.test(word))) {
    throw new Error("notes_search_invalid_words");
  }
  return sql.join(
    words.map(
      (word) =>
        sql`(to_tsquery('notes_spanish'::regconfig, ${prefixOperand(word)}) || to_tsquery('notes_simple'::regconfig, ${prefixOperand(word)}))`,
    ),
    sql` && `,
  );
}

/** A Markdown link or image `[texto](url)` (its URL would spend the fragment's words). */
const MARKDOWN_LINK_PATTERN = "!?\\[([^]\\n]*)\\]\\([^)\\s]*\\)";

/**
 * The body as the headline reads it: links replaced by their names (as in the column), Markdown
 * links by their text, and the highlight markers removed (a note can't forge a highlight).
 */
const headlineBody = sql`translate(regexp_replace(regexp_replace(${notes.body}, ${LINK_PATTERN}, ${"\\2"}, 'g'), ${MARKDOWN_LINK_PATTERN}, ${"\\1"}, 'g'), ${HEADLINE_OPEN + HEADLINE_CLOSE}, '')`;

/** Postgres stops a search that takes longer (a pathological body or query never hangs a page). */
const SEARCH_STATEMENT_TIMEOUT = "5s";

/** Text with something to read (a letter or number): what was left out deserves an «…». */
const hasWords = (text: SQL) => sql`(${text}) ~ '[^[:space:][:punct:]]'`;

/**
 * Live notes matching every word, best first (`ts_rank`: the title weighs more than the body), then
 * by last edit; with the list's kind and area filters. At most `limit`, and whether there are more.
 * `words` must come from `searchWords` (each is checked again: only letters and numbers, 1–50).
 *
 * One transaction with `SET LOCAL statement_timeout` (the pooled connection keeps no setting after
 * it). The fragment's «…» compare it, without markers, with the body it came from: text with
 * letters or numbers before or after it was left out.
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
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local statement_timeout = '${SEARCH_STATEMENT_TIMEOUT}'`));
    // The GIN index finds the rows; Postgres computes the (costly) headline after the sort and the
    // limit, only for the rows returned.
    const found = tx
      .select({
        id: notes.id,
        kind: notes.kind,
        day: notes.day,
        title: notes.title,
        pinnedAt: notes.pinnedAt,
        updatedAt: notes.updatedAt,
        areaName: sql<string | null>`${lifeAreas.name}`.as("area_name"),
        rank: sql<number>`ts_rank(${searchColumn}, (${query}))`.as("rank"),
        doc: sql<string>`${headlineBody}`.as("doc"),
        fragment:
          sql<string>`ts_headline('notes_simple'::regconfig, ${headlineBody}, (${query}), ${HEADLINE_OPTIONS})`.as(
            "fragment",
          ),
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
      .limit(limit + 1)
      .as("found");
    const plainFragment = sql`translate(${found.fragment}, ${HEADLINE_OPEN + HEADLINE_CLOSE}, '')`;
    const at = sql`strpos(${found.doc}, ${plainFragment})`;
    return tx
      .select({
        id: found.id,
        kind: found.kind,
        day: found.day,
        title: found.title,
        pinnedAt: found.pinnedAt,
        updatedAt: found.updatedAt,
        areaName: found.areaName,
        fragment: found.fragment,
        cutStart: sql<boolean>`(${at} > 1 and ${hasWords(sql`left(${found.doc}, ${at} - 1)`)})`,
        cutEnd: sql<boolean>`(${at} > 0 and ${hasWords(sql`substr(${found.doc}, ${at} + length(${plainFragment}))`)})`,
      })
      .from(found)
      .orderBy(sql`${found.rank} desc`, desc(found.updatedAt), asc(found.id));
  });
  return {
    more: rows.length > limit,
    items: rows.slice(0, limit).map((row) => {
      const fragment = fragmentParts(row.fragment ?? "");
      return {
        id: row.id,
        kind: row.kind,
        day: row.day,
        title: row.title,
        excerpt: "",
        fragment,
        cutStart: fragment.length > 0 && row.cutStart === true,
        cutEnd: fragment.length > 0 && row.cutEnd === true,
        pinned: row.pinnedAt !== null,
        editedOn: ownerDateKey(row.updatedAt),
        areaName: row.areaName,
      };
    }),
  };
}
