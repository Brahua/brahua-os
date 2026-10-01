// P3: a project's milestones (add, edit, check, delete and undo, reorder) and the list's
// progress counts, against the throwaway database.
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  INVALID_FIELDS_MESSAGE,
  UNAUTHORIZED_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE,
} from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { deleteProject } from "@/modules/projects/actions";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import {
  addMilestone,
  checkMilestone,
  deleteMilestone,
  reorderMilestones,
  restoreMilestone,
  updateMilestone,
} from "@/modules/projects/milestone-actions";
import { MAX_MILESTONES_PER_PROJECT, MILESTONE_ERRORS } from "@/modules/projects/milestone-input";
import { getProjectMilestones, listMilestoneCounts } from "@/modules/projects/milestone-queries";
import { MILESTONES_ADVISORY_SPACE } from "@/modules/projects/milestones";
import { PROJECT_ERRORS } from "@/modules/projects/project-input";
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
const MISSING = "00000000-0000-4000-8000-000000000000";

let homeId: string;

async function newProject(name = "Mudanza") {
  const [row] = await testDb
    .insert(projects)
    .values({ name, lifeAreaId: homeId })
    .returning({ id: projects.id });
  return row.id;
}

/** Adds milestones through the action; returns their ids in order. */
async function addAll(projectId: string, titles: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const title of titles) {
    const id = crypto.randomUUID();
    const result = await addMilestone({ projectId, id, title });
    expect(result.ok).toBe(true);
    ids.push(id);
  }
  return ids;
}

/** The project's rows in order: title, sort_order and whether it is done. */
async function rows(projectId: string) {
  const found = await testDb
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, projectId))
    .orderBy(asc(projectMilestones.sortOrder));
  return found.map((row) => ({
    id: row.id,
    title: row.title,
    sortOrder: row.sortOrder,
    done: row.doneAt !== null,
    dueDate: row.dueDate,
    deleted: row.deletedAt !== null,
  }));
}

async function liveRows(projectId: string) {
  return (await rows(projectId)).filter((row) => !row.deleted);
}

async function titles(projectId: string) {
  return (await liveRows(projectId)).map((row) => row.title);
}

async function expectContiguous(projectId: string) {
  const orders = (await liveRows(projectId)).map((row) => row.sortOrder);
  expect(orders).toEqual(orders.map((_, index) => index));
}

beforeAll(() => {
  Object.assign(process.env, AUTH_ENV);
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  await seed(testDb);
  const [home] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, "home"));
  homeId = home.id;
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

function expectRevalidated(projectId: string) {
  expect(revalidatePath).toHaveBeenCalledWith("/projects");
  expect(revalidatePath).toHaveBeenCalledWith(`/projects/${projectId}`);
}

describe("add", () => {
  test("adds at the end with a normalized title, contiguous order, and revalidates", async () => {
    const projectId = await newProject();
    await addAll(projectId, ["Planos", "Muebles"]);
    const id = crypto.randomUUID();
    const result = await addMilestone({ projectId, id, title: "  Encimera   de cuarzo " });
    expect(result).toEqual({
      ok: true,
      data: { id, title: "Encimera de cuarzo", dueDate: null, doneAt: null, sortOrder: 2 },
    });
    expect(await titles(projectId)).toEqual(["Planos", "Muebles", "Encimera de cuarzo"]);
    await expectContiguous(projectId);
    expectRevalidated(projectId);
  });

  test.each([
    ["empty", "   ", MILESTONE_ERRORS.titleRequired],
    ["too long", "x".repeat(121), MILESTONE_ERRORS.titleTooLong],
    ["invisible characters", "Hito​", MILESTONE_ERRORS.titleInvisible],
  ])("refuses a title that is %s", async (_, title, message) => {
    const projectId = await newProject();
    const result = await addMilestone({ projectId, id: crypto.randomUUID(), title });
    expect(result).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { title: [message] },
    });
    expect(await rows(projectId)).toEqual([]);
  });

  test("120 characters is fine", async () => {
    const projectId = await newProject();
    const result = await addMilestone({
      projectId,
      id: crypto.randomUUID(),
      title: "x".repeat(120),
    });
    expect(result.ok).toBe(true);
  });

  test("a missing or deleted project is not found", async () => {
    const projectId = await newProject();
    await deleteProject({ id: projectId });
    for (const target of [projectId, MISSING]) {
      const result = await addMilestone({ projectId: target, id: crypto.randomUUID(), title: "X" });
      expect(result).toEqual({ ok: false, error: PROJECT_ERRORS.notFound });
    }
    expect(await testDb.$count(projectMilestones)).toBe(0);
  });

  test("an id that already exists (here or in another project) never overwrites it", async () => {
    const mine = await newProject("Mío");
    const other = await newProject("Otro");
    const [id] = await addAll(other, ["Del otro"]);
    for (const projectId of [mine, other]) {
      const result = await addMilestone({ projectId, id, title: "Robado" });
      expect(result).toEqual({ ok: false, error: UNEXPECTED_ERROR_MESSAGE });
    }
    expect(await titles(other)).toEqual(["Del otro"]);
    expect(await rows(mine)).toEqual([]);
  });

  test(`at most ${MAX_MILESTONES_PER_PROJECT} per project`, async () => {
    const projectId = await newProject();
    await testDb.insert(projectMilestones).values(
      Array.from({ length: MAX_MILESTONES_PER_PROJECT }, (_, index) => ({
        projectId,
        title: `Hito ${index}`,
        sortOrder: index,
      })),
    );
    const result = await addMilestone({ projectId, id: crypto.randomUUID(), title: "Uno más" });
    expect(result).toEqual({ ok: false, error: MILESTONE_ERRORS.tooMany });
    // Only live ones count: after a delete there is room again.
    const [first] = await rows(projectId);
    await deleteMilestone({ projectId, id: first.id });
    const again = await addMilestone({ projectId, id: crypto.randomUUID(), title: "Uno más" });
    expect(again.ok).toBe(true);
  });
});

describe("edit and check", () => {
  test("title and due date; empty date clears it; impossible days are refused", async () => {
    const projectId = await newProject();
    const [id] = await addAll(projectId, ["Planos"]);
    const result = await updateMilestone({
      projectId,
      id,
      title: " Planos  finales ",
      dueDate: "2026-11-30",
    });
    expect(result).toMatchObject({
      ok: true,
      data: { id, title: "Planos finales", dueDate: "2026-11-30" },
    });
    expectRevalidated(projectId);

    const cleared = await updateMilestone({ projectId, id, title: "Planos finales", dueDate: "" });
    expect(cleared).toMatchObject({ ok: true, data: { dueDate: null } });

    const bad = await updateMilestone({ projectId, id, title: "Planos", dueDate: "2026-02-30" });
    expect(bad).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { dueDate: [MILESTONE_ERRORS.dateInvalid] },
    });
    expect((await rows(projectId))[0]).toMatchObject({ title: "Planos finales", dueDate: null });
  });

  test("checking stamps done_at once (checking again keeps it); unchecking clears it", async () => {
    const projectId = await newProject();
    const [id] = await addAll(projectId, ["Planos"]);
    const first = await checkMilestone({ projectId, id, done: true });
    expect(first.ok && first.data.doneAt).toBeInstanceOf(Date);
    const again = await checkMilestone({ projectId, id, done: true });
    expect(again.ok && again.data.doneAt?.getTime()).toBe(first.ok && first.data.doneAt?.getTime());
    const undone = await checkMilestone({ projectId, id, done: false });
    expect(undone).toMatchObject({ ok: true, data: { doneAt: null } });
    expectRevalidated(projectId);
  });

  test("a deleted milestone can't be edited or checked", async () => {
    const projectId = await newProject();
    const [id] = await addAll(projectId, ["Planos"]);
    await deleteMilestone({ projectId, id });
    expect(await checkMilestone({ projectId, id, done: true })).toEqual({
      ok: false,
      error: MILESTONE_ERRORS.notFound,
    });
    expect(await updateMilestone({ projectId, id, title: "X", dueDate: null })).toEqual({
      ok: false,
      error: MILESTONE_ERRORS.notFound,
    });
    expect((await rows(projectId))[0]).toMatchObject({ title: "Planos", done: false });
  });

  test("a milestone that doesn't exist is not found", async () => {
    const projectId = await newProject();
    expect(await checkMilestone({ projectId, id: MISSING, done: true })).toEqual({
      ok: false,
      error: MILESTONE_ERRORS.notFound,
    });
    expect(await updateMilestone({ projectId, id: MISSING, title: "X", dueDate: null })).toEqual({
      ok: false,
      error: MILESTONE_ERRORS.notFound,
    });
  });
});

describe("delete and undo", () => {
  test("a soft delete: out of the list, kept in the table; Deshacer brings the same row back", async () => {
    const projectId = await newProject();
    const [a, b, c] = await addAll(projectId, ["A", "B", "C"]);
    await checkMilestone({ projectId, id: b, done: true });
    await updateMilestone({ projectId, id: b, title: "B", dueDate: "2026-12-01" });
    const [before] = await testDb
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, b));

    const removed = await deleteMilestone({ projectId, id: b });
    expect(removed).toMatchObject({ ok: true, data: { position: 1, milestone: { id: b } } });
    expect(await titles(projectId)).toEqual(["A", "C"]);
    await expectContiguous(projectId);
    expectRevalidated(projectId);
    // Still in the table, with its deletion date.
    const [deleted] = await testDb
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, b));
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(deleted).toMatchObject({ title: "B", doneAt: before.doneAt, dueDate: "2026-12-01" });
    expect((await getProjectMilestones(projectId)).map((item) => item.id)).toEqual([a, c]);

    const restored = await restoreMilestone({ projectId, id: b, position: 1, afterId: a });
    expect(restored.ok && restored.data.map((item) => item.id)).toEqual([a, b, c]);
    const [after] = await testDb
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, b));
    expect(after).toEqual(before);
    await expectContiguous(projectId);

    // A second "Deshacer" changes nothing.
    const twice = await restoreMilestone({ projectId, id: b, position: 0, afterId: null });
    expect(twice.ok).toBe(true);
    expect(await titles(projectId)).toEqual(["A", "B", "C"]);
  });

  test("restoring past the end lands last; deleting twice is not found", async () => {
    const projectId = await newProject();
    const [a] = await addAll(projectId, ["A", "B"]);
    await deleteMilestone({ projectId, id: a });
    expect(await deleteMilestone({ projectId, id: a })).toEqual({
      ok: false,
      error: MILESTONE_ERRORS.notFound,
    });
    await restoreMilestone({ projectId, id: a, position: 9, afterId: null });
    expect(await titles(projectId)).toEqual(["B", "A"]);
    await expectContiguous(projectId);
  });

  test("restore anchors on the neighbour above it, even after the list moved", async () => {
    const projectId = await newProject();
    const [a, b, c, d] = await addAll(projectId, ["A", "B", "C", "D"]);
    // C was third, under B.
    await deleteMilestone({ projectId, id: c });
    // Meanwhile B moved to the top: C comes back right under B, not at index 2.
    await reorderMilestones({ projectId, ids: [b, a, d] });
    await restoreMilestone({ projectId, id: c, position: 2, afterId: b });
    expect(await titles(projectId)).toEqual(["B", "C", "A", "D"]);
    await expectContiguous(projectId);

    // Its anchor deleted too: the old index, clamped to the live list.
    await deleteMilestone({ projectId, id: d });
    await deleteMilestone({ projectId, id: a });
    await restoreMilestone({ projectId, id: d, position: 3, afterId: a });
    expect(await titles(projectId)).toEqual(["B", "C", "D"]);
    await expectContiguous(projectId);
  });

  test("restoring at the limit is refused; an id of another project is not found", async () => {
    const projectId = await newProject();
    const [first] = await addAll(projectId, ["Primero"]);
    await deleteMilestone({ projectId, id: first });
    await testDb.insert(projectMilestones).values(
      Array.from({ length: MAX_MILESTONES_PER_PROJECT }, (_, index) => ({
        projectId,
        title: `Hito ${index}`,
        sortOrder: index,
      })),
    );
    expect(await restoreMilestone({ projectId, id: first, position: 0, afterId: null })).toEqual({
      ok: false,
      error: MILESTONE_ERRORS.tooMany,
    });
    expect(await restoreMilestone({ projectId, id: MISSING, position: 0, afterId: null })).toEqual({
      ok: false,
      error: MILESTONE_ERRORS.notFound,
    });
  });

  test("malformed restore input is a validation error", async () => {
    const projectId = await newProject();
    const result = await restoreMilestone({
      projectId,
      id: crypto.randomUUID(),
      afterId: "ayer",
      position: -1,
    });
    expect(result).toMatchObject({ ok: false, error: INVALID_FIELDS_MESSAGE });
    expect(await rows(projectId)).toEqual([]);
  });
});

describe("reorder", () => {
  test("writes the new order, contiguous", async () => {
    const projectId = await newProject();
    const [a, b, c] = await addAll(projectId, ["A", "B", "C"]);
    const result = await reorderMilestones({ projectId, ids: [c, a, b] });
    expect(result.ok && result.data.map((item) => item.title)).toEqual(["C", "A", "B"]);
    expect(await titles(projectId)).toEqual(["C", "A", "B"]);
    await expectContiguous(projectId);
    expectRevalidated(projectId);
  });

  test("a stale list (one added or deleted meanwhile) is refused without writing", async () => {
    const projectId = await newProject();
    const [a, b, c] = await addAll(projectId, ["A", "B", "C"]);
    const missingOne = await reorderMilestones({ projectId, ids: [b, a] });
    expect(missingOne).toEqual({ ok: false, error: MILESTONE_ERRORS.staleOrder });
    await deleteMilestone({ projectId, id: c });
    const withDeleted = await reorderMilestones({ projectId, ids: [c, b, a] });
    expect(withDeleted).toEqual({ ok: false, error: MILESTONE_ERRORS.staleOrder });
    expect(await titles(projectId)).toEqual(["A", "B"]);
    // Revalidated anyway: the response brings the current list.
    expectRevalidated(projectId);
  });

  test.each([
    ["not a list", () => ({ ids: "a,b" })],
    ["a non-uuid", () => ({ ids: ["x"] })],
    ["repeated ids", (ids: string[]) => ({ ids: [ids[0], ids[0], ids[1]] })],
    ["empty", () => ({ ids: [] })],
    ["too many", () => ({ ids: Array.from({ length: 101 }, () => crypto.randomUUID()) })],
  ])("malformed input (%s) is a validation error", async (_, build) => {
    const projectId = await newProject();
    const ids = await addAll(projectId, ["A", "B"]);
    const result = await reorderMilestones({ projectId, ...build(ids) });
    expect(result).toMatchObject({ ok: false, error: INVALID_FIELDS_MESSAGE });
    expect(await titles(projectId)).toEqual(["A", "B"]);
  });

  test("concurrent reorders, adds and deletes keep sort_order unique and contiguous", async () => {
    const projectId = await newProject();
    const ids = await addAll(projectId, ["A", "B", "C", "D"]);
    const results = await Promise.all([
      reorderMilestones({ projectId, ids: [...ids].reverse() }),
      addMilestone({ projectId, id: crypto.randomUUID(), title: "E" }),
      reorderMilestones({ projectId, ids: [ids[1], ids[0], ids[2], ids[3]] }),
      deleteMilestone({ projectId, id: ids[2] }),
      addMilestone({ projectId, id: crypto.randomUUID(), title: "F" }),
    ]);
    // A reorder that ran after an add or delete had a stale list: refused, never half-applied.
    for (const result of [results[0], results[2]]) {
      if (!result.ok) expect(result.error).toBe(MILESTONE_ERRORS.staleOrder);
    }
    expect(results[1].ok && results[3].ok && results[4].ok).toBe(true);
    // Five live (the deleted one stays in the table).
    expect(await titles(projectId)).toHaveLength(5);
    expect(await testDb.$count(projectMilestones)).toBe(6);
    await expectContiguous(projectId);
  });

  test("the lock is per project: another project's reorder doesn't wait for it", async () => {
    const mine = await newProject("Mío");
    const other = await newProject("Otro");
    await addAll(mine, ["A"]);
    const otherIds = await addAll(other, ["X", "Y"]);
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query(
        "select pg_advisory_xact_lock($1::int, hashtext($2))",
        [MILESTONES_ADVISORY_SPACE, mine],
      );
      // Would hang (and time out) if the lock were global.
      const result = await reorderMilestones({ projectId: other, ids: [...otherIds].reverse() });
      expect(result.ok).toBe(true);
      // While the same project's add waits for the holder.
      const pending = addMilestone({ projectId: mine, id: crypto.randomUUID(), title: "B" });
      await waitForLockWaiters(mine, 1);
      await holder.query("commit");
      expect((await pending).ok).toBe(true);
    } finally {
      holder.release();
    }
    await expectContiguous(mine);
  });
});

/**
 * Waits until `count` connections are blocked on this project's milestone lock (two-key
 * advisory lock: classid and objid hold the two int4 keys as unsigned oids).
 */
async function waitForLockWaiters(projectId: string, count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await testDb.$client.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_locks
       where locktype = 'advisory' and not granted and objsubid = 2
         and classid::bigint = $1::bigint
         and objid::bigint = (hashtext($2)::bigint & 4294967295)`,
      [MILESTONES_ADVISORY_SPACE, projectId],
    );
    if (result.rows[0].waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} lock waiters`);
}

describe("no milestone crosses projects (IDOR)", () => {
  test("every action refuses another project's milestone and leaves it untouched", async () => {
    const mine = await newProject("Mío");
    const other = await newProject("Otro");
    const [theirs] = await addAll(other, ["Del otro"]);
    const [own] = await addAll(mine, ["Mío"]);
    const before = await rows(other);

    const attempts = await Promise.all([
      updateMilestone({ projectId: mine, id: theirs, title: "Cambiado", dueDate: null }),
      checkMilestone({ projectId: mine, id: theirs, done: true }),
      deleteMilestone({ projectId: mine, id: theirs }),
    ]);
    for (const result of attempts) {
      expect(result).toEqual({ ok: false, error: MILESTONE_ERRORS.notFound });
    }
    // Restoring an id that lives in another project is refused too (never moved over).
    expect(
      await restoreMilestone({ projectId: mine, id: theirs, position: 0, afterId: null }),
    ).toEqual({ ok: false, error: MILESTONE_ERRORS.notFound });
    // A reorder that slips in another project's id is a stale (tampered) list.
    expect(await reorderMilestones({ projectId: mine, ids: [theirs, own] })).toEqual({
      ok: false,
      error: MILESTONE_ERRORS.staleOrder,
    });
    expect(await reorderMilestones({ projectId: mine, ids: [theirs] })).toEqual({
      ok: false,
      error: MILESTONE_ERRORS.staleOrder,
    });
    expect(await rows(other)).toEqual(before);
    expect(await titles(mine)).toEqual(["Mío"]);
  });
});

describe("authorization", () => {
  const calls = (projectId: string, id: string) => [
    () => addMilestone({ projectId, id: crypto.randomUUID(), title: "X" }),
    () => updateMilestone({ projectId, id, title: "X", dueDate: null }),
    () => checkMilestone({ projectId, id, done: true }),
    () => deleteMilestone({ projectId, id }),
    () => restoreMilestone({ projectId, id, position: 0, afterId: null }),
    () => reorderMilestones({ projectId, ids: [id] }),
  ];

  test.each([
    ["no session", async () => new Headers()],
    [
      "a forged cookie",
      async () => new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s every action is refused and nothing changes", async (_, headers) => {
    const projectId = await newProject();
    const [id] = await addAll(projectId, ["Planos"]);
    const before = await rows(projectId);
    request.headers = await headers();
    for (const call of calls(projectId, id)) {
      expect(await call()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await rows(projectId)).toEqual(before);
  });
});

describe("reads", () => {
  test("a project's milestones in order; a malformed id reads nothing", async () => {
    const projectId = await newProject();
    await addAll(projectId, ["A", "B"]);
    expect((await getProjectMilestones(projectId)).map((item) => item.title)).toEqual(["A", "B"]);
    expect(await getProjectMilestones("not-a-uuid")).toEqual([]);
  });

  test("the list's counts come in one aggregate, without deleted projects or milestones", async () => {
    const withSome = await newProject("Con hitos");
    const deleted = await newProject("Eliminado");
    await newProject("Sin hitos");
    const ids = await addAll(withSome, ["A", "B", "C", "D"]);
    await checkMilestone({ projectId: withSome, id: ids[0], done: true });
    // A deleted milestone counts for nothing, done or not.
    await checkMilestone({ projectId: withSome, id: ids[3], done: true });
    await deleteMilestone({ projectId: withSome, id: ids[3] });
    await addAll(deleted, ["X"]);
    await deleteProject({ id: deleted });
    expect(await listMilestoneCounts()).toEqual({ [withSome]: { done: 1, total: 3 } });
  });

  test("the export keeps every milestone as history: deleted ones and deleted projects' too", async () => {
    const projectId = await newProject();
    const [a] = await addAll(projectId, ["A", "B"]);
    await deleteMilestone({ projectId, id: a });
    await deleteProject({ id: projectId });
    const data = await buildExport(testDb, new Date());
    const exported = data.tables.project_milestones;
    expect(exported.rowCount).toBe(2);
    expect(
      exported.rows.map((row) => [row.title, row.project_id, row.deleted_at !== null]),
    ).toEqual(
      expect.arrayContaining([
        ["A", projectId, true],
        ["B", projectId, false],
      ]),
    );
  });
});
