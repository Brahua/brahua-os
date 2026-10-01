// P4: "Bloqueado por" (dependencies between projects) against the throwaway database: add and
// remove, no self-dependency and no cycles (direct, indirect, or two adds racing), deleted
// projects, the blocked state as statuses change, authorization and the export.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import {
  addDependency,
  changeProjectStatus,
  deleteProject,
  removeDependency,
  restoreProject,
} from "@/modules/projects/actions";
import { projectDependencies, projects } from "@/modules/projects/db/schema";
import { DEPENDENCY_ERRORS } from "@/modules/projects/dependency-input";
import { PROJECT_ERRORS } from "@/modules/projects/project-input";
import { insertDependency, selectActiveBlockers } from "@/modules/projects/projects";
import { getProjectDependencies, listActiveBlockers } from "@/modules/projects/queries";
import { testDatabaseUrl } from "./helpers";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

// The actions read the request headers (session cookie) and the app database: point both at
// the test, and record revalidations instead of touching Next's cache.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };
const MISSING = "00000000-0000-4000-8000-000000000000";

async function areaId(slug: string): Promise<string> {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, slug));
  return area.id;
}

/** A project straight in the table, bypassing the actions. */
async function insertRaw(name: string, values: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(projects)
    .values({ name, lifeAreaId: await areaId("home"), ...values })
    .returning();
  return row;
}

/** `projectId` blocked by `blockedById`, straight in the table. */
async function edge(projectId: string, blockedById: string) {
  await testDb.insert(projectDependencies).values({ projectId, blockedById });
}

/** Every edge as `[project, blocker]` names, sorted. */
async function edges(): Promise<string[][]> {
  const rows = await testDb.select().from(projectDependencies);
  const names = new Map(
    (await testDb.select({ id: projects.id, name: projects.name }).from(projects)).map((p) => [
      p.id,
      p.name,
    ]),
  );
  return rows.map((row) => [names.get(row.projectId)!, names.get(row.blockedById)!]).sort();
}

const fieldError = (message: string) => ({
  ok: false,
  error: INVALID_FIELDS_MESSAGE,
  fieldErrors: { blockedById: [message] },
});

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

describe("add and remove", () => {
  test("addDependency records the edge and revalidates the list and the page", async () => {
    const a = await insertRaw("A");
    const b = await insertRaw("B");
    expect(await addDependency({ id: a.id, blockedById: b.id })).toEqual({
      ok: true,
      data: { id: a.id, blockedById: b.id },
    });
    expect(await edges()).toEqual([["A", "B"]]);
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${a.id}`);
  });

  test("adding the same blocker twice changes nothing", async () => {
    const a = await insertRaw("A");
    const b = await insertRaw("B");
    await addDependency({ id: a.id, blockedById: b.id });
    expect((await addDependency({ id: a.id, blockedById: b.id })).ok).toBe(true);
    expect(await testDb.$count(projectDependencies)).toBe(1);
  });

  test("a project can have several blockers and block several projects", async () => {
    const [a, b, c] = [await insertRaw("A"), await insertRaw("B"), await insertRaw("C")];
    await addDependency({ id: a.id, blockedById: b.id });
    await addDependency({ id: a.id, blockedById: c.id });
    await addDependency({ id: c.id, blockedById: b.id });
    expect(await edges()).toEqual([
      ["A", "B"],
      ["A", "C"],
      ["C", "B"],
    ]);
  });

  test("removeDependency deletes only that edge; undo adds it back", async () => {
    const [a, b, c] = [await insertRaw("A"), await insertRaw("B"), await insertRaw("C")];
    await edge(a.id, b.id);
    await edge(a.id, c.id);
    expect(await removeDependency({ id: a.id, blockedById: b.id })).toEqual({
      ok: true,
      data: { id: a.id, blockedById: b.id },
    });
    expect(await edges()).toEqual([["A", "C"]]);
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${a.id}`);
    // Removing again is not an error (a second tab, a double tap).
    expect((await removeDependency({ id: a.id, blockedById: b.id })).ok).toBe(true);
    // "Deshacer".
    expect((await addDependency({ id: a.id, blockedById: b.id })).ok).toBe(true);
    expect(await edges()).toEqual([
      ["A", "B"],
      ["A", "C"],
    ]);
  });

  test("malformed ids are field errors and never reach the database", async () => {
    const a = await insertRaw("A");
    expect(await addDependency({ id: a.id, blockedById: "x" })).toEqual(
      fieldError(DEPENDENCY_ERRORS.unavailable),
    );
    expect(await addDependency({ id: "x", blockedById: a.id })).toMatchObject({
      ok: false,
      fieldErrors: { id: [PROJECT_ERRORS.notFound] },
    });
    expect(await removeDependency({ id: a.id })).toMatchObject({ ok: false });
    expect(await testDb.$count(projectDependencies)).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("no self-dependency and no cycles", () => {
  test("a project can't block itself", async () => {
    const a = await insertRaw("A");
    expect(await addDependency({ id: a.id, blockedById: a.id })).toEqual(
      fieldError(DEPENDENCY_ERRORS.self),
    );
    // The data layer refuses it too (the schema is not its only guard).
    expect(await insertDependency(testDb, a.id, a.id)).toBe("self");
    expect(await testDb.$count(projectDependencies)).toBe(0);
  });

  test("a direct cycle is refused: B can't wait for A when A waits for B", async () => {
    const [a, b] = [await insertRaw("A"), await insertRaw("B")];
    expect((await addDependency({ id: a.id, blockedById: b.id })).ok).toBe(true);
    expect(await addDependency({ id: b.id, blockedById: a.id })).toEqual(
      fieldError(DEPENDENCY_ERRORS.cycle),
    );
    expect(await edges()).toEqual([["A", "B"]]);
    // Refused, but revalidated: the page's candidates were stale.
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${b.id}`);
  });

  test("an indirect cycle is refused (A → B → C, then C → A), and a longer one", async () => {
    const [a, b, c, d] = [
      await insertRaw("A"),
      await insertRaw("B"),
      await insertRaw("C"),
      await insertRaw("D"),
    ];
    await addDependency({ id: a.id, blockedById: b.id });
    await addDependency({ id: b.id, blockedById: c.id });
    expect(await addDependency({ id: c.id, blockedById: a.id })).toEqual(
      fieldError(DEPENDENCY_ERRORS.cycle),
    );
    await addDependency({ id: c.id, blockedById: d.id });
    expect(await addDependency({ id: d.id, blockedById: a.id })).toEqual(
      fieldError(DEPENDENCY_ERRORS.cycle),
    );
    // Not a cycle: two paths to the same blocker (a diamond) is fine.
    expect((await addDependency({ id: a.id, blockedById: d.id })).ok).toBe(true);
    expect(await edges()).toEqual([
      ["A", "B"],
      ["A", "D"],
      ["B", "C"],
      ["C", "D"],
    ]);
  });

  test("a deleted project in the middle still counts: restoring it can't leave a cycle", async () => {
    const [a, b, c] = [await insertRaw("A"), await insertRaw("B"), await insertRaw("C")];
    await edge(a.id, b.id);
    await edge(b.id, c.id);
    await deleteProject({ id: b.id });
    expect(await addDependency({ id: c.id, blockedById: a.id })).toEqual(
      fieldError(DEPENDENCY_ERRORS.cycle),
    );
    await restoreProject({ id: b.id });
    expect(await edges()).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
  });
});

describe("two adds at the same time (two connections)", () => {
  /** A transaction on a connection of its own, driven step by step by the test. */
  async function openTransaction() {
    const client = new Client({ connectionString: testDatabaseUrl() });
    await client.connect();
    await client.query("begin");
    return client;
  }

  /** Whether `promise` is still pending after `ms`. */
  async function stillPending(promise: Promise<unknown>, ms = 200) {
    const timeout = Symbol("pending");
    const winner = await Promise.race([
      promise.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve(timeout), ms)),
    ]);
    return winner === timeout;
  }

  test("an add waits for one in progress, then sees its edge and refuses the cycle", async () => {
    const [a, b] = [await insertRaw("A"), await insertRaw("B")];
    const first = await openTransaction();
    try {
      // What insertDependency does: take the graph's lock, check, insert (A blocked by B).
      await first.query("select pg_advisory_xact_lock(hashtext('project_dependencies'))");
      await first.query(
        "insert into project_dependencies (project_id, blocked_by_id) values ($1, $2)",
        [a.id, b.id],
      );

      // B blocked by A: without the lock its check would not see the uncommitted edge.
      const second = addDependency({ id: b.id, blockedById: a.id });
      expect(await stillPending(second)).toBe(true);

      await first.query("commit");
      expect(await second).toEqual(fieldError(DEPENDENCY_ERRORS.cycle));
    } finally {
      await first.end();
    }
    expect(await edges()).toEqual([["A", "B"]]);
  });

  test("racing through the action on both sides: exactly one of the pair commits", async () => {
    const [a, b] = [await insertRaw("A"), await insertRaw("B")];
    const results = await Promise.all([
      addDependency({ id: a.id, blockedById: b.id }),
      addDependency({ id: b.id, blockedById: a.id }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([fieldError(DEPENDENCY_ERRORS.cycle)]);
    expect(await testDb.$count(projectDependencies)).toBe(1);
  });

  test("a delete of the blocker waits for an add in progress (FOR SHARE)", async () => {
    const [a, b] = [await insertRaw("A"), await insertRaw("B")];
    const adder = await openTransaction();
    try {
      await adder.query("select pg_advisory_xact_lock(hashtext('project_dependencies'))");
      await adder.query(
        "select id from projects where id = any($1) and deleted_at is null for share",
        [[a.id, b.id]],
      );
      const remove = deleteProject({ id: b.id });
      expect(await stillPending(remove)).toBe(true);
      await adder.query("commit");
      expect((await remove).ok).toBe(true);
    } finally {
      await adder.end();
    }
  });
});

describe("deleted projects", () => {
  test("a deleted or missing project can't be added as a blocker", async () => {
    const a = await insertRaw("A");
    const gone = await insertRaw("Gone", { deletedAt: new Date() });
    for (const blockedById of [gone.id, MISSING]) {
      expect(await addDependency({ id: a.id, blockedById })).toEqual(
        fieldError(DEPENDENCY_ERRORS.unavailable),
      );
    }
    expect(await testDb.$count(projectDependencies)).toBe(0);
  });

  test("a deleted or missing project can't get or lose blockers (no IDOR on the project)", async () => {
    const b = await insertRaw("B");
    const gone = await insertRaw("Gone", { deletedAt: new Date() });
    await edge(gone.id, b.id);
    for (const id of [gone.id, MISSING]) {
      expect(await addDependency({ id, blockedById: b.id })).toEqual({
        ok: false,
        error: PROJECT_ERRORS.notFound,
      });
      expect(await removeDependency({ id, blockedById: b.id })).toEqual({
        ok: false,
        error: PROJECT_ERRORS.notFound,
      });
    }
    // The deleted project's edge is kept (its history; it comes back with "Deshacer").
    expect(await edges()).toEqual([["Gone", "B"]]);
  });

  test("a deleted blocker stops blocking and leaves the page; restored, it is back", async () => {
    const a = await insertRaw("A", { status: "active" });
    const b = await insertRaw("B", { status: "active" });
    await edge(a.id, b.id);
    expect(await listActiveBlockers()).toEqual({ [a.id]: [{ id: b.id, name: "B" }] });

    await deleteProject({ id: b.id });
    expect(await listActiveBlockers()).toEqual({});
    const page = await getProjectDependencies(a.id);
    expect(page.blockers).toEqual([]);
    expect(page.blocking).toEqual([]);
    expect(page.candidates.map((p) => p.name)).not.toContain("B");

    await restoreProject({ id: b.id });
    expect(await listActiveBlockers()).toEqual({ [a.id]: [{ id: b.id, name: "B" }] });
  });

  test("a deleted project's own blockers don't show in the list", async () => {
    const a = await insertRaw("A", { deletedAt: new Date() });
    const b = await insertRaw("B");
    await edge(a.id, b.id);
    expect(await listActiveBlockers()).toEqual({});
  });
});

describe("blocked state", () => {
  test("blocked while any blocker is neither done nor canceled; clears and comes back", async () => {
    const a = await insertRaw("A", { status: "active" });
    const b = await insertRaw("Bote", { status: "active" });
    const c = await insertRaw("Casa", { status: "idea" });
    await addDependency({ id: a.id, blockedById: b.id });
    await addDependency({ id: a.id, blockedById: c.id });
    const blockersOfA = async () => (await listActiveBlockers())[a.id]?.map((x) => x.name) ?? [];

    expect(await blockersOfA()).toEqual(["Bote", "Casa"]);
    for (const status of ["paused", "maintenance"] as const) {
      await changeProjectStatus({ id: b.id, status });
      expect(await blockersOfA()).toEqual(["Bote", "Casa"]);
    }
    await changeProjectStatus({ id: b.id, status: "done" });
    expect(await blockersOfA()).toEqual(["Casa"]);
    await changeProjectStatus({ id: c.id, status: "canceled" });
    expect(await blockersOfA()).toEqual([]);
    expect(await listActiveBlockers()).toEqual({});

    // Back to active: it blocks again.
    await changeProjectStatus({ id: b.id, status: "active" });
    expect(await blockersOfA()).toEqual(["Bote"]);
  });

  test("the page gets every blocker with its state, the ones that block, and the candidates", async () => {
    const a = await insertRaw("A");
    const done = await insertRaw("Hecho", { status: "done", completedAt: new Date() });
    const open = await insertRaw("Abierto", { status: "active" });
    const free = await insertRaw("Libre");
    const blockedByA = await insertRaw("Espera a A");
    const blockedByThat = await insertRaw("Espera a Espera");
    await insertRaw("Eliminado", { deletedAt: new Date() });
    await edge(a.id, done.id);
    await edge(a.id, open.id);
    await edge(blockedByA.id, a.id);
    await edge(blockedByThat.id, blockedByA.id);

    const page = await getProjectDependencies(a.id);
    expect(page.blockers.map((p) => [p.name, p.status])).toEqual([
      ["Abierto", "active"],
      ["Hecho", "done"],
    ]);
    expect(page.blockers[0].area).toMatchObject({ slug: "home", name: "Hogar" });
    expect(page.blocking).toEqual([{ id: open.id, name: "Abierto" }]);
    // Not itself, its blockers, the deleted one, nor what it blocks (directly or not).
    expect(page.candidates.map((p) => p.name)).toEqual([free.name]);
  });

  test("selectActiveBlockers narrows to the projects asked for, in one query", async () => {
    const [a, b, c] = [await insertRaw("A"), await insertRaw("B"), await insertRaw("C")];
    await edge(a.id, c.id);
    await edge(b.id, c.id);
    expect(await selectActiveBlockers(testDb, [b.id])).toEqual([
      { projectId: b.id, id: c.id, name: "C" },
    ]);
    expect(await selectActiveBlockers(testDb, [])).toEqual([]);
  });

  test("a malformed id gets nothing, without a query", async () => {
    expect(await getProjectDependencies("not-a-uuid")).toEqual({
      blockers: [],
      blocking: [],
      candidates: [],
    });
  });
});

describe("authorization", () => {
  async function expectRejected() {
    const [a, b, c] = [await insertRaw("A"), await insertRaw("B"), await insertRaw("C")];
    await edge(a.id, c.id);
    expect(await addDependency({ id: a.id, blockedById: b.id })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    expect(await removeDependency({ id: a.id, blockedById: c.id })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    // Invalid input is not even looked at.
    expect(await addDependency({})).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    expect(await edges()).toEqual([["A", "C"]]);
    expect(revalidatePath).not.toHaveBeenCalled();
  }

  test("without a session", async () => {
    request.headers = new Headers();
    await expectRejected();
  });

  test("with a forged session cookie", async () => {
    request.headers = new Headers({ cookie: "better-auth.session_token=forged.signature" });
    await expectRejected();
  });

  test("with a valid session of someone who is not the owner", async () => {
    request.headers = new Headers({ cookie: await sessionCookieFor(OTHER) });
    await expectRejected();
  });

  test("the queries redirect to /login without an owner session", async () => {
    request.headers = new Headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(listActiveBlockers()).rejects.toMatchObject(redirect);
    await expect(getProjectDependencies(MISSING)).rejects.toMatchObject(redirect);
  });
});

test("the export includes the dependencies, a deleted blocker's too", async () => {
  const [a, b] = [await insertRaw("A"), await insertRaw("B")];
  await addDependency({ id: a.id, blockedById: b.id });
  await deleteProject({ id: b.id });
  const data = JSON.parse(JSON.stringify(await buildExport(testDb, new Date())));
  expect(data.tables.project_dependencies.rows).toEqual([
    { project_id: a.id, blocked_by_id: b.id },
  ]);
});
