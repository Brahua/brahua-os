// N4 of `notes` against the throwaway database: migration 0028's generated `search` column and the
// search (SPEC-notes "Búsqueda"). Accents and case don't matter («polit» → «políticas», «Arbol» →
// «árbol»), words are prefixes (also when the prefix stems away from the document's stem), every
// word must match, the title weighs more than the body, a link counts by its name and never by its
// uuid or type, deleted notes are out, tsquery operators in the text are only separators (no error),
// the fragment marks what was found with our own markers (a note can't forge them), the column
// follows a save, the export leaves it out, the filters apply, and the read checks the owner.
import { eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { buildExport } from "@/lib/data-export";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { saveNote } from "@/modules/notes/actions";
import { notes } from "@/modules/notes/db/schema";
import { searchNotes } from "@/modules/notes/queries";
import { HEADLINE_CLOSE, HEADLINE_OPEN, searchWords } from "@/modules/notes/search";
import { selectNoteSearch, wordsQuery } from "@/modules/notes/search-data";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };
const TODAY = ownerDateKey(new Date());
const PROJECT_ID = "0b8a9c1e-1111-4222-8333-444455556666";

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

/** A knowledge note, edited `minutesAgo` minutes ago. */
async function page(
  title: string,
  body: string,
  values: Partial<typeof notes.$inferInsert> = {},
  minutesAgo = 0,
) {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const [row] = await testDb
    .insert(notes)
    .values({ kind: "page", title, body, updatedAt: at, createdAt: at, ...values })
    .returning({ id: notes.id });
  return row.id;
}

async function daily(day: string, body: string) {
  const [row] = await testDb
    .insert(notes)
    .values({ kind: "daily", day, body })
    .returning({ id: notes.id });
  return row.id;
}

async function search(text: string, filter: Partial<Parameters<typeof searchNotes>[0]> = {}) {
  return searchNotes({ text, kind: "all", areaId: null, shown: 30, ...filter });
}

const ids = async (text: string) => (await search(text)).items.map((item) => item.id);

describe("migration 0028", () => {
  test("adds unaccent, the two configurations, the generated column and its GIN index", async () => {
    const { rows } = await testDb.execute<{
      unaccent: number;
      configs: string;
      generated: string;
      indexdef: string;
    }>(sql`
      select
        (select count(*)::int from pg_extension where extname = 'unaccent') as unaccent,
        (select string_agg(cfgname, ',' order by cfgname) from pg_ts_config
          where cfgname in ('notes_spanish', 'notes_simple')) as configs,
        (select attgenerated::text from pg_attribute
          where attrelid = 'notes'::regclass and attname = 'search') as generated,
        (select indexdef from pg_indexes where indexname = 'notes_search_idx') as indexdef
    `);
    expect(rows[0].unaccent).toBe(1);
    expect(rows[0].configs).toBe("notes_simple,notes_spanish");
    // 's' = STORED (Postgres 18's default would be virtual, which can't be indexed).
    expect(rows[0].generated).toBe("s");
    expect(rows[0].indexdef).toMatch(/USING gin \(search\)/);
  });
});

describe("matching", () => {
  test("accents and case don't matter, in the query or in the note", async () => {
    const iam = await page(
      "Apuntes IAM",
      "Las políticas de IAM se evalúan antes de cada petición.",
    );
    const tree = await page("Jardín", "El ÁRBOL del patio.");
    await page("Otra", "Nada que ver.");
    expect(await ids("polit")).toEqual([iam]);
    expect(await ids("POLÍTICAS")).toEqual([iam]);
    expect(await ids("evaluan")).toEqual([iam]);
    expect(await ids("Arbol")).toEqual([tree]);
    expect(await ids("árbol")).toEqual([tree]);
    expect(await ids("jardin")).toEqual([tree]);
  });

  test("a word is a prefix, also when the prefix stems away from the document's stem", async () => {
    const gym = await page("Rutina", "Fui al gimnasio temprano.");
    const talk = await page("Charla", "Las comunicaciones del equipo.");
    expect(await ids("gim")).toEqual([gym]);
    expect(await ids("gimnas")).toEqual([gym]);
    // «comunicaciones» stems to 'comun'; the whole-word half of the column finds the prefix.
    expect(await ids("comunicac")).toEqual([talk]);
    // Positive control: a prefix of nothing finds nothing.
    expect(await ids("xyzw")).toEqual([]);
  });

  test("every word must match (AND), and a Spanish stop word still searches", async () => {
    const both = await page("Viaje", "Políticas del gimnasio de la empresa.");
    const one = await page("Solo", "Políticas de vacaciones.");
    expect((await ids("polit")).sort()).toEqual([both, one].sort());
    expect(await ids("polit gim")).toEqual([both]);
    expect(await ids("de gim")).toEqual([both]);
  });

  test("a daily note is found by its body (it has no title)", async () => {
    const id = await daily(TODAY, "Hablé con Ana sobre el presupuesto.");
    expect(await ids("presupuest")).toEqual([id]);
  });

  test("a link is found by its saved name, never by its type or its uuid", async () => {
    const id = await page("Reunión", `Hablé de [[project:${PROJECT_ID}|Ruta AWS]] con Ana.`);
    expect(await ids("ruta")).toEqual([id]);
    expect(await ids("aws")).toEqual([id]);
    expect(await ids("0b8a9c1e")).toEqual([]);
    expect(await ids("444455556666")).toEqual([]);
    expect(await ids("project")).toEqual([]);
    // A malformed link stays text (as the renderer draws it): its words count.
    const raw = await page("Roto", "[[proyecto:abc|Algo]]");
    expect(await ids("proyecto")).toEqual([raw]);
  });

  test("deleted notes are out", async () => {
    const live = await page("Viva", "Docker en casa.");
    await page("Borrada", "Docker en la oficina.", { deletedAt: new Date() });
    expect(await ids("docker")).toEqual([live]);
  });
});

describe("order and paging", () => {
  test("the title weighs more than the body, then the last edit decides", async () => {
    // The body match is newer, but the title match goes first.
    const inBody = await page("Semana", "Instalé Kubernetes en el clúster.", {}, 1);
    const inTitle = await page("Kubernetes", "Apuntes del curso.", {}, 60);
    expect(await ids("kubern")).toEqual([inTitle, inBody]);
    // Same weight: the newest edit first.
    const older = await page("Uno", "Terraform básico.", {}, 120);
    const newer = await page("Dos", "Terraform avanzado.", {}, 5);
    expect(await ids("terraform")).toEqual([newer, older]);
  });

  test("at most `shown` results, and whether there are more", async () => {
    for (let index = 0; index < 4; index++) await page(`Nota ${index}`, "Ansible", {}, index);
    const firstPage = await search("ansible", { shown: 3 });
    expect(firstPage.items).toHaveLength(3);
    expect(firstPage.more).toBe(true);
    const all = await search("ansible", { shown: 30 });
    expect(all.items).toHaveLength(4);
    expect(all.more).toBe(false);
  });

  test("the list's kind and area filters apply to the search", async () => {
    const [area] = await testDb
      .select({ id: lifeAreas.id })
      .from(lifeAreas)
      .where(eq(lifeAreas.slug, "work"));
    const withArea = await page("Con área", "Presupuesto anual", { areaId: area.id });
    const withoutArea = await page("Sin área", "Presupuesto mensual");
    const day = await daily(TODAY, "Presupuesto del día");
    expect((await search("presupuesto", { kind: "daily" })).items.map((i) => i.id)).toEqual([day]);
    expect((await search("presupuesto", { kind: "page" })).items.map((i) => i.id).sort()).toEqual(
      [withArea, withoutArea].sort(),
    );
    expect((await search("presupuesto", { areaId: area.id })).items.map((i) => i.id)).toEqual([
      withArea,
    ]);
    // A malformed area id doesn't reach the query (every note is searched).
    expect((await search("presupuesto", { areaId: "nope" })).items).toHaveLength(3);
  });
});

describe("the owner's text is never tsquery syntax", () => {
  test.each([
    ["polit & !gim", "both"],
    ["polit | gim", "both"],
    ["!polit", "one"],
    ["polit:* <-> gim", "both"],
    ["'polit' (gim)", "both"],
    ["polit\\ gim", "both"],
    // Its words are «polit drop table notes»: none of the notes has them all.
    ["polit'; drop table notes; --", "none"],
    ['"polit" gim', "both"],
    ["polit 🙂 gim", "both"],
    ["polit::gim", "both"],
    ["polit & & & | ! ( ) : * '", "one"],
  ])("«%s» searches its words without an error", async (text, expected) => {
    const both = await page("Ambas", "Políticas del gimnasio.");
    const one = await page("Una", "Políticas de vacaciones.");
    const found = await ids(text);
    const wanted = { both: [both], one: [both, one], none: [] }[expected] ?? [];
    expect(found.sort()).toEqual(wanted.sort());
    // The table is still there.
    expect((await testDb.select({ id: notes.id }).from(notes)).length).toBe(2);
  });

  test("only operators, or fewer than 2 characters, search nothing", async () => {
    await page("Algo", "Políticas.");
    expect((await search("& | ! : * ( ) <->")).items).toEqual([]);
    expect((await search("p")).items).toEqual([]);
    expect((await search("🙂🙂")).items).toEqual([]);
  });

  test("nine or more words: the first eight are searched", async () => {
    const id = await page("Muchas", "uno dos tres cuatro cinco seis siete ocho");
    // The ninth word matches nothing, but it isn't searched.
    expect(await ids("uno dos tres cuatro cinco seis siete ocho zzzzz")).toEqual([id]);
    expect(await ids("uno dos tres cuatro cinco seis siete zzzzz")).toEqual([]);
  });

  test("every letter and number of the Basic Multilingual Plane is a valid query word", async () => {
    // A character the text search parser didn't take as part of a word would leave a bare `:*`,
    // which is a syntax error. Every BMP letter and number, each alone, through both configurations.
    const characters: string[] = [];
    for (let code = 0x30; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const character = String.fromCodePoint(code);
      if (/^[\p{L}\p{N}]$/u.test(character)) characters.push(character);
    }
    const failures: string[] = [];
    for (let start = 0; start < characters.length; start += 2_000) {
      const chunk = characters.slice(start, start + 2_000).map((c) => `${c}:*`);
      try {
        await testDb.execute(sql`
          select count(*) from unnest(${chunk}::text[]) as w(word),
            lateral (select to_tsquery('notes_spanish'::regconfig, w.word)
                       || to_tsquery('notes_simple'::regconfig, w.word) as q) as parsed
        `);
      } catch {
        // Narrow down the chunk one character at a time to name the offenders.
        for (const word of chunk) {
          try {
            await testDb.execute(
              sql`select to_tsquery('notes_spanish'::regconfig, ${word}) || to_tsquery('notes_simple'::regconfig, ${word})`,
            );
          } catch {
            failures.push(`U+${word.codePointAt(0)!.toString(16).toUpperCase()}`);
          }
        }
      }
    }
    expect(characters.length).toBeGreaterThan(40_000);
    expect(failures).toEqual([]);
  }, 120_000);

  test("the words go as bound parameters, never inside the SQL text", () => {
    const query = new PgDialect().sqlToQuery(wordsQuery(searchWords("polit gim")));
    expect(query.sql).not.toMatch(/polit|gim/);
    expect(query.params).toEqual(["polit:*", "polit:*", "gim:*", "gim:*"]);
  });
});

describe("the fragment", () => {
  test("marks the words found, with link names instead of the link syntax", async () => {
    await page(
      "Apuntes IAM",
      `Hoy en [[project:${PROJECT_ID}|Ruta AWS]] vimos que las **políticas** de IAM se evalúan antes de cada petición.`,
    );
    const [item] = (await search("polit")).items;
    const marked = item.fragment.filter((part) => part.mark).map((part) => part.text);
    expect(marked).toEqual(["políticas"]);
    const text = item.fragment.map((part) => part.text).join("");
    expect(text).toContain("Ruta AWS");
    expect(text).not.toContain("[[");
    expect(text).not.toContain(PROJECT_ID);
    // Markdown's emphasis marks are dropped.
    expect(text).not.toContain("**");
  });

  test("a note can't forge a highlight with the markers' characters", async () => {
    await page("Falsa", `Texto ${HEADLINE_OPEN}falso${HEADLINE_CLOSE} y docker al final.`);
    const [item] = (await search("docker")).items;
    expect(item.fragment.filter((part) => part.mark).map((part) => part.text)).toEqual(["docker"]);
    const text = item.fragment.map((part) => part.text).join("");
    expect(text).toContain("falso");
    expect(text).not.toMatch(/[\uE000\uE001]/);
  });

  test("a match only in the title still shows the start of the body, without marks", async () => {
    await page("Kubernetes", "Apuntes del curso de la semana pasada.");
    const [item] = (await search("kubern")).items;
    expect(item.fragment.map((part) => part.text).join("")).toContain("Apuntes del curso");
    expect(item.fragment.some((part) => part.mark)).toBe(false);
    // An empty body: no fragment at all.
    await testDb.update(notes).set({ body: "" });
    const [empty] = (await search("kubern")).items;
    expect(empty.fragment).toEqual([]);
  });
});

describe("the generated column follows the note", () => {
  test("a save through the action changes what the search finds", async () => {
    const id = await page("Diario", "Hablé de políticas.");
    expect(await ids("polit")).toEqual([id]);
    const saved = await saveNote({ id, body: "Ahora hablo del gimnasio.", version: 1 });
    expect(saved.ok).toBe(true);
    expect(await ids("polit")).toEqual([]);
    expect(await ids("gim")).toEqual([id]);
    // A rename changes it too.
    await testDb.update(notes).set({ title: "Terraform" }).where(eq(notes.id, id));
    expect(await ids("terraf")).toEqual([id]);
  });

  test("the export leaves the column out (it is derived from the title and the body)", async () => {
    await page("Apuntes IAM", "Políticas.");
    const data = await buildExport(testDb, new Date());
    const [row] = data.tables.notes.rows as Record<string, unknown>[];
    expect(row.title).toBe("Apuntes IAM");
    expect(Object.keys(row)).not.toContain("search");
  });

  test("a raw insert can't write the column (it is generated)", async () => {
    await expect(
      testDb.execute(
        sql`insert into notes (kind, title, body, search) values ('page', 'X', 'y', to_tsvector('simple', 'z'))`,
      ),
    ).rejects.toMatchObject({ cause: { code: "428C9" } });
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the search redirects to /login", async (_, headers) => {
    await page("Apuntes IAM", "Políticas.");
    // Positive control: the owner finds it.
    expect(await ids("polit")).toHaveLength(1);
    request.headers = await headers();
    await expect(search("polit")).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });

  test("the data function with no words returns nothing without a query", async () => {
    const spy = vi.spyOn(testDb, "select");
    try {
      expect(
        await selectNoteSearch(testDb, { words: [], kind: "all", areaId: null, limit: 30 }),
      ).toEqual({ items: [], more: false });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
