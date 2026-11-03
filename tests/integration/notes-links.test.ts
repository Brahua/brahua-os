// N2 of `notes` against the throwaway database: every link source's `search` (no accents or case,
// `%` and `_` as themselves, deleted rows out, live ones first, pending tasks before done ones) and
// `resolve` (current names, deleted rows marked, tasks' state, unknown ids missing); the picker's
// search through the composition root (at most 8); a note's links resolved one query per type; the
// backlinks («Enlazada desde», «Mencionado en»: deleted notes don't count, another type or an id
// that differs in its last character doesn't either); and the authorization of every new read.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { searchNoteLinks } from "@/lib/note-link-actions";
import { NOTE_LINK_SOURCES } from "@/lib/note-link-sources";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { goals } from "@/modules/goals/db/schema";
import { resolveGoalLinkTargets, searchGoalLinkTargets } from "@/modules/goals/note-link-source";
import { habits } from "@/modules/habits/db/schema";
import { resolveHabitLinkTargets, searchHabitLinkTargets } from "@/modules/habits/note-link-source";
import { learningTracks } from "@/modules/learning/db/schema";
import {
  resolveTrackLinkTargets,
  searchTrackLinkTargets,
} from "@/modules/learning/note-link-source";
import { getNoteMentions } from "@/modules/notes/contracts";
import { notes } from "@/modules/notes/db/schema";
import {
  resolveLinks,
  resolveNoteLinkTargets,
  searchNoteLinkTargets,
  selectLinkingNotes,
} from "@/modules/notes/links";
import { dailyTitle } from "@/modules/notes/note-day";
import { getLinkedFrom, getNoteLinkResolutions } from "@/modules/notes/queries";
import { projects } from "@/modules/projects/db/schema";
import {
  resolveProjectLinkTargets,
  searchProjectLinkTargets,
} from "@/modules/projects/note-link-source";
import { tasks } from "@/modules/tasks/db/schema";
import { resolveTaskLinkTargets, searchTaskLinkTargets } from "@/modules/tasks/note-link-source";
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
let areaId: string;

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  await seed(testDb);
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, "work"));
  areaId = area.id;
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

async function project(name: string, values: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(projects)
    .values({ name, lifeAreaId: areaId, status: "active", ...values })
    .returning({ id: projects.id });
  return row.id;
}

async function task(title: string, values: Partial<typeof tasks.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(tasks)
    .values({ title, ...values })
    .returning({ id: tasks.id });
  return row.id;
}

let sortOrder = 0;
async function habit(name: string, values: Partial<typeof habits.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(habits)
    .values({
      name,
      measure: "check",
      frequency: "daily",
      startDate: "2026-09-01",
      sortOrder: sortOrder++,
      ...values,
    })
    .returning({ id: habits.id });
  return row.id;
}

let position = 0;
async function goal(title: string, values: Partial<typeof goals.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(goals)
    .values({
      title,
      periodKind: "year",
      year: 2026,
      sourceKind: "manual",
      target: 12,
      unit: "libros",
      position: position++,
      ...values,
    })
    .returning({ id: goals.id });
  return row.id;
}

async function track(title: string, values: Partial<typeof learningTracks.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(learningTracks)
    .values({ title, kind: "course", position: position++, ...values })
    .returning({ id: learningTracks.id });
  return row.id;
}

async function note(values: Partial<typeof notes.$inferInsert>) {
  const [row] = await testDb
    .insert(notes)
    .values({ kind: "page", title: "Nota", ...values })
    .returning({ id: notes.id });
  return row.id;
}

const names = (rows: { name: string }[]) => rows.map((row) => row.name);
const deletedAt = new Date();

describe("search of each source", () => {
  test("projects: no accents or case, open ones first, deleted ones never", async () => {
    await project("Educación financiera", { status: "canceled" });
    await project("EDUCACIÓN de Ana");
    await project("Mi educacion", { deletedAt });
    await project("Otra cosa");
    const rows = await searchProjectLinkTargets(testDb, "educacion", 8);
    // Open first (and among open ones, prefixes first); the canceled one last, with its state.
    expect(names(rows)).toEqual(["EDUCACIÓN de Ana", "Educación financiera"]);
    expect(rows[1].hint).toBe("Cancelado");
    expect(rows[0].hint).toBe(null);
    expect(names(await searchProjectLinkTargets(testDb, "ÉDU", 8))).toHaveLength(2);
    expect(await searchProjectLinkTargets(testDb, "educacion", 1)).toHaveLength(1);
  });

  test("`%`, `_` and `\\` match themselves (never wildcards)", async () => {
    await project("100% listo");
    await project("1000 listo");
    await project("plan_a");
    await project("planXa");
    await project("ruta\\b");
    expect(names(await searchProjectLinkTargets(testDb, "0%", 8))).toEqual(["100% listo"]);
    expect(names(await searchProjectLinkTargets(testDb, "n_a", 8))).toEqual(["plan_a"]);
    expect(names(await searchProjectLinkTargets(testDb, "a\\b", 8))).toEqual(["ruta\\b"]);
    // Positive control: a plain text finds both.
    expect(names(await searchProjectLinkTargets(testDb, "listo", 8))).toHaveLength(2);
  });

  test("tasks: pending before done (marked «Hecha»), deleted never", async () => {
    await task("Llamar al banco", { doneAt: new Date() });
    await task("llamar a mamá");
    await task("Llamar al dentista", { deletedAt });
    const rows = await searchTaskLinkTargets(testDb, "LLAMAR", 8);
    expect(names(rows)).toEqual(["llamar a mamá", "Llamar al banco"]);
    expect(rows.map((row) => row.hint)).toEqual([null, "Hecha"]);
  });

  test("habits: archived ones last (marked), deleted never", async () => {
    await habit("Meditar mañana", { archivedAt: new Date() });
    await habit("Meditación");
    await habit("Meditar noche", { deletedAt });
    const rows = await searchHabitLinkTargets(testDb, "medit", 8);
    expect(names(rows)).toEqual(["Meditación", "Meditar mañana"]);
    expect(rows[1].hint).toBe("Archivado");
  });

  test("goals: active first, deleted never", async () => {
    await goal("Leer 12 libros", { status: "archived" });
    await goal("Leer más");
    await goal("Leer poesía", { deletedAt });
    const rows = await searchGoalLinkTargets(testDb, "leer", 8);
    expect(names(rows)).toEqual(["Leer más", "Leer 12 libros"]);
    expect(rows[1].hint).toBe("Archivada");
  });

  test("learning tracks: in progress first, deleted never", async () => {
    await track("AWS Solutions", { status: "waiting" });
    await track("aws IAM");
    await track("AWS viejo", { deletedAt });
    const rows = await searchTrackLinkTargets(testDb, "aws", 8);
    expect(names(rows)).toEqual(["aws IAM", "AWS Solutions"]);
    expect(rows[1].hint).toBe("En espera");
  });

  test("notes: knowledge notes by title (pinned first) and daily notes by their day", async () => {
    await note({ title: "Apuntes de política" });
    await note({ title: "Políticas IAM", pinnedAt: new Date() });
    await note({ title: "Política borrada", deletedAt });
    const day = await note({ kind: "daily", title: null, day: "2026-11-03", body: "x" });
    await note({ kind: "daily", title: null, day: "2025-11-03", body: "y" });
    await note({ kind: "daily", title: null, day: "2026-11-04", body: "z" });

    expect(names(await searchNoteLinkTargets(testDb, "politica", 8, TODAY))).toEqual([
      "Políticas IAM",
      "Apuntes de política",
    ]);
    const byDay = await searchNoteLinkTargets(testDb, "3 nov", 8, "2026-11-05");
    // Every year, most recent first; named by the long date, marked «Diario».
    expect(byDay.map((row) => row.id)[0]).toBe(day);
    expect(names(byDay)).toEqual([
      dailyTitle("2026-11-03", "2026-11-05"),
      dailyTitle("2025-11-03", "2026-11-05"),
    ]);
    expect(byDay[0].hint).toBe("Diario");
    expect(names(await searchNoteLinkTargets(testDb, "2026-11", 8, "2026-11-05"))).toHaveLength(2);
    expect(await searchNoteLinkTargets(testDb, "3 nov 2025", 8, "2026-11-05")).toHaveLength(1);
  });
});

describe("resolve of each source", () => {
  test("current names, pages built from the id, deleted ones marked, unknown ids missing", async () => {
    const unknown = "00000000-0000-4000-8000-000000000999";
    const p = await project("Ruta AWS + IA");
    const pGone = await project("Viejo", { deletedAt });
    expect(await resolveProjectLinkTargets(testDb, [p, pGone, unknown])).toEqual(
      expect.arrayContaining([
        { id: p, name: "Ruta AWS + IA", href: `/projects/${p}`, deleted: false },
        { id: pGone, name: "Viejo", href: `/projects/${pGone}`, deleted: true },
      ]),
    );
    expect(await resolveProjectLinkTargets(testDb, [unknown])).toEqual([]);
    expect(await resolveProjectLinkTargets(testDb, [])).toEqual([]);

    const t = await task("Llamar", { doneAt: new Date() });
    expect(await resolveTaskLinkTargets(testDb, [t])).toEqual([
      { id: t, name: "Llamar", href: `/tasks/${t}`, deleted: false, done: true },
    ]);
    const h = await habit("Meditar", { deletedAt });
    expect(await resolveHabitLinkTargets(testDb, [h])).toEqual([
      { id: h, name: "Meditar", href: `/habits/${h}`, deleted: true },
    ]);
    const g = await goal("Leer");
    expect(await resolveGoalLinkTargets(testDb, [g])).toEqual([
      { id: g, name: "Leer", href: `/goals/${g}`, deleted: false },
    ]);
    const l = await track("AWS");
    expect(await resolveTrackLinkTargets(testDb, [l])).toEqual([
      { id: l, name: "AWS", href: `/learning/${l}`, deleted: false },
    ]);
    const n = await note({ title: "Ideas" });
    const d = await note({ kind: "daily", title: null, day: "2026-11-03", body: "x" });
    expect(await resolveNoteLinkTargets(testDb, [n, d], "2026-11-05")).toEqual(
      expect.arrayContaining([
        { id: n, name: "Ideas", href: `/notes/${n}`, deleted: false },
        {
          id: d,
          name: dailyTitle("2026-11-03", "2026-11-05"),
          href: "/notes/2026-11-03",
          deleted: false,
        },
      ]),
    );
  });

  test("a note's links: one entry per target, renamed names current, a deleted target marked", async () => {
    const p = await project("Nombre nuevo");
    const t = await task("Borrada", { deletedAt });
    const body = `Ver [[project:${p}|Nombre viejo]], [[task:${t}|Borrada]] y [[project:${p}|otra vez]]`;
    const resolutions = await resolveLinks(testDb, NOTE_LINK_SOURCES, body);
    expect(resolutions).toEqual({
      [`project:${p}`]: { name: "Nombre nuevo", href: `/projects/${p}`, deleted: false },
      [`task:${t}`]: { name: "Borrada", href: `/tasks/${t}`, deleted: true, done: false },
    });
    expect(await getNoteLinkResolutions(NOTE_LINK_SOURCES, body)).toEqual(resolutions);
    expect(await resolveLinks(testDb, NOTE_LINK_SOURCES, "sin enlaces")).toEqual({});
  });
});

describe("the picker's search (Server Action)", () => {
  test("every source at once, grouped, at most 8 in all", async () => {
    for (let index = 0; index < 6; index++) await project(`Ruta ${index}`);
    for (let index = 0; index < 6; index++) await task(`ruta ${index}`);
    await note({ title: "Ruta de estudio" });
    const result = await searchNoteLinks({ q: "ruta" });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.data.map((group) => group.type)).toEqual(["note", "project", "task"]);
    expect(result.data.flatMap((group) => group.items)).toHaveLength(8);
    expect(result.data[0]).toMatchObject({ label: "Notas", items: [{ name: "Ruta de estudio" }] });
  });

  test("a NUL or a wildcard in the text doesn't break the query; too long is refused", async () => {
    await project("Ruta");
    const nul = await searchNoteLinks({ q: "Ru\u0000" });
    expect(nul.ok).toBe(true);
    expect(await searchNoteLinks({ q: "%" })).toEqual({ ok: true, data: [] });
    const long = await searchNoteLinks({ q: "x".repeat(81) });
    expect(long).toMatchObject({ ok: false, error: INVALID_FIELDS_MESSAGE });
    expect(await searchNoteLinks({})).toMatchObject({ ok: false });
  });
});

describe("backlinks", () => {
  test("live notes linking to a target; deleted notes, other types and a near id don't count", async () => {
    const p = await project("Ruta");
    // Same uuid but its last character: never a match (the pattern ends with `|`).
    const near = p.slice(0, -1) + (p.endsWith("0") ? "1" : "0");
    const linking = await note({ title: "Plan", body: `Ver [[project:${p}|Ruta]]` });
    const daily = await note({
      kind: "daily",
      title: null,
      day: "2026-11-03",
      body: `- [[project:${p}|Ruta]] hoy`,
    });
    await note({ title: "Borrada", body: `[[project:${p}|Ruta]]`, deletedAt });
    await note({ title: "Otro tipo", body: `[[task:${p}|Ruta]]` });
    await note({ title: "Casi", body: `[[project:${near}|Otra]]` });
    await note({ title: "Texto suelto", body: `el id ${p} sin enlace` });

    const rows = await selectLinkingNotes(testDb, "project", p, "2026-11-05");
    expect(rows.map((row) => row.id).sort()).toEqual([linking, daily].sort());
    expect(rows.find((row) => row.id === daily)).toMatchObject({
      kind: "daily",
      name: dailyTitle("2026-11-03", "2026-11-05"),
      href: "/notes/2026-11-03",
    });
    expect((await getNoteMentions("project", p)).map((row) => row.id).sort()).toEqual(
      [linking, daily].sort(),
    );
    // Positive control for the near id: its own link counts.
    expect(await selectLinkingNotes(testDb, "project", near, TODAY)).toHaveLength(1);
    // Invalid input never reaches a query.
    expect(await selectLinkingNotes(testDb, "project", "%", TODAY)).toEqual([]);
    expect(await selectLinkingNotes(testDb, "folder" as never, p, TODAY)).toEqual([]);
  });

  test("«Enlazada desde»: other notes linking to this note, never itself", async () => {
    const target = await note({ title: "Apuntes IAM" });
    await testDb
      .update(notes)
      .set({ body: `Yo mismo: [[note:${target}|Apuntes IAM]]` })
      .where(eq(notes.id, target));
    const other = await note({ title: "Diario de AWS", body: `Ver [[note:${target}|IAM]]` });
    expect((await getLinkedFrom(target)).map((row) => row.id)).toEqual([other]);
    expect(await getLinkedFrom("no-uuid")).toEqual([]);
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the reads redirect to /login and the search is refused", async (_, headers) => {
    const p = await project("Ruta");
    const target = await note({ title: "Destino" });
    // Positive control: the owner searches.
    const owner = await searchNoteLinks({ q: "ruta" });
    expect(owner.ok && owner.data.length).toBe(1);

    request.headers = await headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    expect(await searchNoteLinks({ q: "ruta" })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    await expect(getNoteMentions("project", p)).rejects.toMatchObject(redirect);
    await expect(getLinkedFrom(target)).rejects.toMatchObject(redirect);
    await expect(
      getNoteLinkResolutions(NOTE_LINK_SOURCES, `[[project:${p}|Ruta]]`),
    ).rejects.toMatchObject(redirect);
  });
});
