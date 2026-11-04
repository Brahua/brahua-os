-- notes N4: full-text search inside Notas (SPEC-notes "Búsqueda"). Additive: an extension, two text
-- search configurations, a generated column and its GIN index. Hand-written (`drizzle-kit generate
-- --custom`): the column and the index live only here, never in src/modules/notes/db/schema.ts, so
-- Drizzle never selects, exports or tries to drop them (src/modules/notes/search.ts reads them by
-- name). Safe to run twice.
--
-- 1) `unaccent` ships with Postgres' contrib: the local embedded-postgres 18, CI's postgres:18 image
-- and Neon all have it.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
-- 2) `notes_spanish`: Spanish stemming without accents or case («políticas» → 'polit'). `notes_simple`:
-- the whole word without accents or case («comunicaciones» → 'comunicaciones'). A prefix typed by
-- the owner can stem away from the document's stem («comunicac» → 'comunicac', the document has
-- 'comun'), so the column holds both and a query word matches either (search.ts). Words with digits
-- («año2026») lose their accents too.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'notes_spanish') THEN
    CREATE TEXT SEARCH CONFIGURATION notes_spanish (COPY = spanish);
    ALTER TEXT SEARCH CONFIGURATION notes_spanish
      ALTER MAPPING FOR hword, hword_part, word WITH unaccent, spanish_stem;
    ALTER TEXT SEARCH CONFIGURATION notes_spanish
      ALTER MAPPING FOR numword, numhword, hword_numpart WITH unaccent, simple;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'notes_simple') THEN
    CREATE TEXT SEARCH CONFIGURATION notes_simple (COPY = simple);
    ALTER TEXT SEARCH CONFIGURATION notes_simple
      ALTER MAPPING FOR hword, hword_part, word, numword, numhword, hword_numpart WITH unaccent, simple;
  END IF;
END
$$;--> statement-breakpoint
-- 3) The title weighs more than the body (A over B). In the body a link `[[type:uuid|Nombre]]` counts
-- by its saved name, never by its type or uuid (the same pattern as src/lib/markdown/note-links.ts).
-- Every function here is IMMUTABLE with a constant regconfig, as a generated column needs. STORED:
-- Postgres 18 makes generated columns virtual by default, and a virtual one can't be indexed.
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "search" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('notes_spanish'::regconfig, coalesce("title", '')), 'A')
  || setweight(to_tsvector('notes_simple'::regconfig, coalesce("title", '')), 'A')
  || setweight(to_tsvector('notes_spanish'::regconfig, regexp_replace("body", '\[\[(note|project|task|habit|goal|learning):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|([^][|\r\n]+)\]\]', '\2', 'g')), 'B')
  || setweight(to_tsvector('notes_simple'::regconfig, regexp_replace("body", '\[\[(note|project|task|habit|goal|learning):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|([^][|\r\n]+)\]\]', '\2', 'g')), 'B')
) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_search_idx" ON "notes" USING gin ("search");
