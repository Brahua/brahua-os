// L1 of `learning` against the throwaway database: the tracks table's CHECKs with raw inserts,
// creating with a pasted syllabus, the limit of 2 in progress (two requests at once, with a
// positive control, and the status lock), status changes and their exact «Deshacer», settings,
// delete and restore, authorization and the export.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { learningSteps, learningTracks } from "@/modules/learning/db/schema";
import { LEARNING_ACTIVE_KEY, LEARNING_ADVISORY_SPACE } from "@/modules/learning/lock-keys";
import {
  getDeletedTrack,
  getTrack,
  listActiveTracks,
  listProjectChoices,
  listSteps,
  listTracks,
} from "@/modules/learning/queries";
import {
  changeStatus,
  createTrack,
  deleteTrack,
  restoreTrack,
  undoStatus,
  updateTrack,
} from "@/modules/learning/tracks-actions";
import type { CreateResult, StatusResult } from "@/modules/learning/tracks-input";
import { projects } from "@/modules/projects/db/schema";
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

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

async function create(values: Record<string, unknown> = {}): Promise<CreateResult> {
  const result = await createTrack({ title: "AWS SAA", kind: "certification", ...values });
  if (!result.ok) throw new Error(`createTrack failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function status(id: string, to: string, pauseTrackId?: string): Promise<StatusResult> {
  const result = await changeStatus({ id, to, pauseTrackId });
  if (!result.ok) throw new Error(`changeStatus failed: ${JSON.stringify(result)}`);
  return result.data;
}

const rowOf = async (id: string) =>
  (await testDb.select().from(learningTracks).where(eq(learningTracks.id, id)))[0];

const activeTitles = async () =>
  (await listTracks()).filter((track) => track.status === "active").map((track) => track.title);

async function newProject(values: Partial<typeof projects.$inferInsert> = {}): Promise<string> {
  const [area] = await testDb.select({ id: lifeAreas.id }).from(lifeAreas).limit(1);
  const [project] = await testDb
    .insert(projects)
    .values({ name: "Ruta AWS + IA", lifeAreaId: area.id, status: "active", ...values })
    .returning({ id: projects.id });
  return project.id;
}

/** The constraint a raw statement breaks (Postgres error code and constraint name), or null. */
async function violation(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
}

const BASE = { title: "Curso", kind: "course", position: 0 } as const;

describe("the table's own CHECKs", () => {
  test("a valid row goes in, in progress by default", async () => {
    const [row] = await testDb.insert(learningTracks).values(BASE).returning();
    expect(row).toMatchObject({ status: "active", finishedAt: null, deletedAt: null });
  });

  test.each([
    ["an empty title", { title: "" }, "learning_tracks_title_check"],
    ["a title of 121 characters", { title: "x".repeat(121) }, "learning_tracks_title_check"],
    ["an unknown kind", { kind: "podcast" }, "learning_tracks_kind_check"],
    ["an unknown status", { status: "abandoned" }, "learning_tracks_status_check"],
    ["done without a finished time", { status: "done" }, "learning_tracks_finished_check"],
    [
      "a finished time while waiting",
      { status: "waiting", finishedAt: new Date() },
      "learning_tracks_finished_check",
    ],
    ["a link that isn't http(s)", { url: "ftp://x.com" }, "learning_tracks_url_check"],
    ["a link with a space", { url: "https://x .com" }, "learning_tracks_url_check"],
    ["an uppercase scheme", { url: "HTTPS://x.com" }, "learning_tracks_url_check"],
    [
      "a link of 2001 characters",
      { url: `https://x.com/${"a".repeat(1987)}` },
      "learning_tracks_url_check",
    ],
    ["a weekly target of 14", { weeklyTargetMinutes: 14 }, "learning_tracks_weekly_target_check"],
    [
      "a weekly target of 3001",
      { weeklyTargetMinutes: 3001 },
      "learning_tracks_weekly_target_check",
    ],
    ["a date in 1999", { targetDate: "1999-12-31" }, "learning_tracks_target_date_check"],
    ["a negative position", { position: -1 }, "learning_tracks_position_check"],
  ] as const)("%s is refused", async (_, patch, constraint) => {
    const result = await violation(() =>
      testDb
        .insert(learningTracks)
        .values({ ...BASE, ...patch } as typeof learningTracks.$inferInsert),
    );
    expect(result).toEqual({ code: "23514", constraint });
  });

  test("positive controls: done with a time, the bounds themselves, a 2000-character link", async () => {
    await testDb.insert(learningTracks).values([
      { ...BASE, status: "done", finishedAt: new Date() },
      {
        ...BASE,
        title: "x".repeat(120),
        weeklyTargetMinutes: 15,
        targetDate: "2100-12-31",
        url: `https://x.com/${"a".repeat(1986)}`,
      },
      { ...BASE, weeklyTargetMinutes: 3000, targetDate: "2000-01-01" },
    ]);
    expect(await testDb.select().from(learningTracks)).toHaveLength(3);
  });

  test("steps: title 1–200, position ≥ 0, a track that exists; a track with steps can't be deleted", async () => {
    const [track] = await testDb.insert(learningTracks).values(BASE).returning();
    const step = { trackId: track.id, title: "Clase 1", position: 0 };
    for (const [patch, constraint] of [
      [{ title: "" }, "learning_steps_title_check"],
      [{ title: "x".repeat(201) }, "learning_steps_title_check"],
      [{ position: -1 }, "learning_steps_position_check"],
    ] as const) {
      expect(
        await violation(() => testDb.insert(learningSteps).values({ ...step, ...patch })),
      ).toEqual({ code: "23514", constraint });
    }
    await testDb.insert(learningSteps).values({ ...step, title: "x".repeat(200) });
    expect(
      await violation(() =>
        testDb
          .insert(learningSteps)
          .values({ ...step, trackId: "00000000-0000-4000-8000-0000000000ff" }),
      ),
    ).toMatchObject({ code: "23503" });
    // ON DELETE RESTRICT reports restrict_violation (23001), not foreign_key_violation (23503).
    expect(await violation(() => testDb.delete(learningTracks))).toMatchObject({ code: "23001" });
  });

  test("a project with tracks can't be deleted physically (RESTRICT)", async () => {
    const projectId = await newProject();
    await testDb.insert(learningTracks).values({ ...BASE, projectId });
    expect(await violation(() => testDb.delete(projects))).toMatchObject({ code: "23001" });
  });
});

describe("creating", () => {
  test("with its pasted syllabus: 40 lines make 40 steps in order, blank lines left out", async () => {
    const syllabus = Array.from({ length: 40 }, (_, i) => `Clase ${i + 1}`).join("\n\n");
    const { track, changes } = await create({ syllabus, weeklyTargetMinutes: 180 });
    expect(changes).toEqual([]);
    expect(track).toMatchObject({
      title: "AWS SAA",
      kind: "certification",
      status: "active",
      weeklyTargetMinutes: 180,
      steps: { done: 0, total: 40 },
      upcoming: [
        { id: expect.any(String), title: "Clase 1" },
        { id: expect.any(String), title: "Clase 2" },
      ],
    });
    const steps = await listSteps(track.id);
    expect(steps.map((step) => step.title)).toEqual(
      Array.from({ length: 40 }, (_, i) => `Clase ${i + 1}`),
    );
    expect(steps.map((step) => step.position)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(vi.mocked(revalidatePath).mock.calls).toContainEqual(["/learning", "layout"]);
  });

  test("500 steps fit; 501, a NUL or a line of 201 are refused before the database", async () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `P${i}`).join("\n");
    expect((await create({ syllabus: lines(500) })).track.steps.total).toBe(500);
    for (const syllabus of [lines(501), "Uno\nDos\u0000", `Uno\n${"x".repeat(201)}`]) {
      const result = await createTrack({ title: "Otro", kind: "course", syllabus });
      expect(result).toMatchObject({ ok: false, fieldErrors: { syllabus: [expect.any(String)] } });
    }
    expect(await testDb.select().from(learningTracks)).toHaveLength(1);
  });

  test("a practice has no syllabus; one sent is refused", async () => {
    const result = await createTrack({ title: "Inglés", kind: "practice", syllabus: "Unidad 1" });
    expect(result.ok).toBe(false);
    const { track } = await create({ title: "Inglés", kind: "practice" });
    expect(track.steps).toEqual({ done: 0, total: 0 });
  });

  test("with a project that exists; a deleted or unknown one is refused on its field", async () => {
    const projectId = await newProject();
    expect((await create({ projectId })).track.projectId).toBe(projectId);
    const gone = await newProject({ name: "Viejo", deletedAt: new Date() });
    for (const id of [gone, "00000000-0000-4000-8000-0000000000ff"]) {
      const result = await createTrack({
        title: "X",
        kind: "book",
        status: "waiting",
        projectId: id,
      });
      expect(result).toMatchObject({ ok: false, fieldErrors: { projectId: [expect.any(String)] } });
    }
    // The form's choices come from the projects' contract; a finished linked one is added.
    const finished = await newProject({
      name: "Terminado",
      status: "done",
      completedAt: new Date(),
    });
    expect((await listProjectChoices()).map((project) => project.name)).toEqual(["Ruta AWS + IA"]);
    expect((await listProjectChoices(finished)).map((project) => project.name)).toEqual([
      "Ruta AWS + IA",
      "Terminado",
    ]);
  });

  test("the link is stored normalized; the server never follows it", async () => {
    const { track } = await create({ url: " HTTPS://platzi.com/cursos/aws " });
    expect(track.url).toBe("https://platzi.com/cursos/aws");
  });
});

describe("the limit of 2 in progress", () => {
  test("a third one is refused, and naming one to pause moves it to «En espera» in the same write", async () => {
    const a = (await create({ title: "A" })).track;
    await create({ title: "B" });
    const third = await createTrack({ title: "C", kind: "book" });
    expect(third).toMatchObject({ ok: false, fieldErrors: { pauseTrackId: [expect.any(String)] } });
    expect(await activeTitles()).toEqual(["A", "B"]);
    // Waiting is always fine.
    expect((await create({ title: "D", status: "waiting" })).track.status).toBe("waiting");
    const swap = await create({ title: "C", pauseTrackId: a.id });
    expect(swap.changes).toMatchObject([{ id: a.id, from: { status: "active" }, to: "waiting" }]);
    expect(await activeTitles()).toEqual(["B", "C"]);
    // A track to pause that isn't in progress is refused, and nothing changes.
    const wrong = await createTrack({ title: "E", kind: "book", pauseTrackId: a.id });
    expect(wrong.ok).toBe(false);
    expect(await activeTitles()).toEqual(["B", "C"]);
  });

  test("two requests at once never make a third; with 1 in progress, exactly one of two gets in", async () => {
    await create({ title: "A" });
    // Positive control: one slot left, two requests: one in progress, the other refused.
    const [x, y] = await Promise.all([
      createTrack({ title: "X", kind: "book" }),
      createTrack({ title: "Y", kind: "book" }),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(await activeTitles()).toHaveLength(2);
    // Full: two «Poner en curso» at once, both refused.
    const w1 = (await create({ title: "W1", status: "waiting" })).track;
    const w2 = (await create({ title: "W2", status: "waiting" })).track;
    const both = await Promise.all([
      changeStatus({ id: w1.id, to: "active" }),
      changeStatus({ id: w2.id, to: "active" }),
    ]);
    expect(both.map((result) => result.ok)).toEqual([false, false]);
    expect(await activeTitles()).toHaveLength(2);
  });

  test("with 1 in progress, two «Poner en curso» at once: one in, one refused", async () => {
    await create({ title: "A" });
    const w1 = (await create({ title: "W1", status: "waiting" })).track;
    const w2 = (await create({ title: "W2", status: "waiting" })).track;
    const results = await Promise.all([
      changeStatus({ id: w1.id, to: "active" }),
      changeStatus({ id: w2.id, to: "active" }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await activeTitles()).toHaveLength(2);
  });

  test("a status change waits for the status lock", async () => {
    const waiting = (await create({ title: "W", status: "waiting" })).track;
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        LEARNING_ADVISORY_SPACE,
        LEARNING_ACTIVE_KEY,
      ]);
      let settled = false;
      const blocked = changeStatus({ id: waiting.id, to: "active" }).then((result) => {
        settled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(settled).toBe(false);
      await holder.query("commit");
      expect((await blocked).ok).toBe(true);
    } finally {
      holder.release();
    }
  });
});

describe("status and its «Deshacer»", () => {
  test("pause, finish (with its time to the millisecond) and reopen; asking for the same status changes nothing", async () => {
    const { track } = await create();
    expect((await status(track.id, "active")).changes).toEqual([]);
    const paused = await status(track.id, "waiting");
    expect(paused.changes).toMatchObject([
      { from: { status: "active", finishedAt: null }, to: "waiting" },
    ]);
    const done = await status(track.id, "done");
    expect(done.track.finishedAt).not.toBeNull();
    const row = await rowOf(track.id);
    expect(row.finishedAt?.toISOString()).toBe(done.track.finishedAt);
    const reopened = await status(track.id, "active");
    expect(reopened.changes[0].from).toEqual({
      status: "done",
      position: row.position,
      finishedAt: done.track.finishedAt,
    });
    expect((await rowOf(track.id)).finishedAt).toBeNull();
    // «Deshacer» of the reopen: done again, with the same finished time and place.
    expect(await undoStatus({ changes: reopened.changes })).toEqual({
      ok: true,
      data: { restored: true },
    });
    const back = await rowOf(track.id);
    expect(back).toMatchObject({ status: "done", position: row.position });
    expect(back.finishedAt?.toISOString()).toBe(done.track.finishedAt);
  });

  test("the undo of a swap puts both back; after another change it writes nothing", async () => {
    const a = (await create({ title: "A" })).track;
    const b = (await create({ title: "B" })).track;
    const c = (await create({ title: "C", status: "waiting" })).track;
    const swap = await status(c.id, "active", a.id);
    expect(swap.changes.map((change) => [change.id, change.to])).toEqual([
      [a.id, "waiting"],
      [c.id, "active"],
    ]);
    expect(await activeTitles()).toEqual(["B", "C"]);
    expect((await undoStatus({ changes: swap.changes })).ok).toBe(true);
    expect((await activeTitles()).toSorted()).toEqual(["A", "B"]);
    expect((await rowOf(a.id)).position).toBe(swap.changes[0].from.position);
    // A second «Deshacer» finds them as they are now: nothing is written.
    const again = await undoStatus({ changes: swap.changes });
    expect(again.ok).toBe(false);
    expect((await activeTitles()).toSorted()).toEqual(["A", "B"]);
    void b;
  });

  test("an undo that would make a third in progress writes nothing", async () => {
    const a = (await create({ title: "A" })).track;
    const paused = await status(a.id, "waiting");
    await create({ title: "B" });
    await create({ title: "C" });
    expect((await undoStatus({ changes: paused.changes })).ok).toBe(false);
    expect((await rowOf(a.id)).status).toBe("waiting");
  });

  test("a missing or deleted track is not found", async () => {
    const missing = await changeStatus({ id: "00000000-0000-4000-8000-0000000000ff", to: "done" });
    expect(missing.ok).toBe(false);
  });
});

describe("settings", () => {
  test("every field, sent whole: a missing optional field is cleared", async () => {
    const projectId = await newProject();
    const { track } = await create({
      weeklyTargetMinutes: 120,
      targetDate: "2026-12-15",
      projectId,
    });
    const result = await updateTrack({ id: track.id, title: "AWS SAA C03", kind: "course" });
    expect(result).toMatchObject({
      ok: true,
      data: {
        title: "AWS SAA C03",
        kind: "course",
        weeklyTargetMinutes: null,
        targetDate: null,
        projectId: null,
        url: null,
      },
    });
  });

  test("a track with steps can't become a practice; without steps it can", async () => {
    const withSteps = (await create({ syllabus: "Clase 1" })).track;
    const refused = await updateTrack({ id: withSteps.id, title: "X", kind: "practice" });
    expect(refused).toMatchObject({ ok: false, fieldErrors: { kind: [expect.any(String)] } });
    const empty = (await create({ title: "Vacío", status: "waiting" })).track;
    expect((await updateTrack({ id: empty.id, title: "Vacío", kind: "practice" })).ok).toBe(true);
  });
});

describe("delete and restore", () => {
  test("out of every view with its steps, kept in the table; «Deshacer» brings it back", async () => {
    const { track } = await create({ syllabus: "Clase 1\nClase 2" });
    const deleted = await deleteTrack({ id: track.id });
    expect(deleted).toEqual({ ok: true, data: { id: track.id, title: "AWS SAA" } });
    expect(await listTracks()).toEqual([]);
    expect(await getTrack(track.id)).toBeNull();
    expect(await getDeletedTrack(track.id)).toEqual({ id: track.id, title: "AWS SAA" });
    expect((await deleteTrack({ id: track.id })).ok).toBe(false);
    const restored = await restoreTrack({ id: track.id });
    expect(restored).toMatchObject({
      ok: true,
      data: { movedToWaiting: false, track: { status: "active", steps: { total: 2 } } },
    });
    expect(await getDeletedTrack(track.id)).toBeNull();
    // Twice is fine.
    expect((await restoreTrack({ id: track.id })).ok).toBe(true);
  });

  test("one that was in progress comes back «En espera» when 2 already are (never a third)", async () => {
    const a = (await create({ title: "A" })).track;
    await deleteTrack({ id: a.id });
    await create({ title: "B" });
    await create({ title: "C" });
    const restored = await restoreTrack({ id: a.id });
    expect(restored).toMatchObject({
      ok: true,
      data: { movedToWaiting: true, track: { status: "waiting" } },
    });
    expect(await activeTitles()).toEqual(["B", "C"]);
    expect((await listActiveTracks()).map((track) => track.title)).toEqual(["B", "C"]);
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the reads redirect to /login and every write is refused", async (_, headers) => {
    const { track } = await create({ title: "Del owner" });
    // Positive control: the owner reads.
    expect(await listTracks()).toHaveLength(1);

    request.headers = await headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(listTracks()).rejects.toMatchObject(redirect);
    await expect(getTrack(track.id)).rejects.toMatchObject(redirect);
    await expect(listActiveTracks()).rejects.toMatchObject(redirect);
    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    expect(await createTrack({ title: "Intruso", kind: "book" })).toEqual(refused);
    expect(await updateTrack({ id: track.id, title: "X", kind: "book" })).toEqual(refused);
    expect(await changeStatus({ id: track.id, to: "done" })).toEqual(refused);
    expect(
      await undoStatus({
        changes: [
          {
            id: track.id,
            from: { status: "waiting", position: 0, finishedAt: null },
            to: "active",
          },
        ],
      }),
    ).toEqual(refused);
    expect(await deleteTrack({ id: track.id })).toEqual(refused);
    expect(await restoreTrack({ id: track.id })).toEqual(refused);
    expect(await rowOf(track.id)).toMatchObject({
      title: "Del owner",
      status: "active",
      deletedAt: null,
    });
  });
});

describe("export", () => {
  test("every track and step is exported, deleted and done ones included", async () => {
    const a = (await create({ title: "A", syllabus: "Uno\nDos" })).track;
    const b = (await create({ title: "B", status: "waiting" })).track;
    await status(b.id, "done");
    await deleteTrack({ id: a.id });

    const data = await buildExport(testDb, new Date("2026-11-02T15:00:00Z"));
    const tracks = data.tables.learning_tracks;
    expect(tracks.rowCount).toBe(2);
    expect(
      tracks.rows.map((row) => [row.title, row.status, row.deleted_at !== null]).toSorted(),
    ).toEqual([
      ["A", "active", true],
      ["B", "done", false],
    ]);
    expect(data.tables.learning_steps.rows.map((row) => row.title)).toEqual(["Uno", "Dos"]);
  });
});
