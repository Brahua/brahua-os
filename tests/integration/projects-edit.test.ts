// P2: editing a project from its page, soft delete and undo, against the throwaway database.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { archiveLifeArea } from "@/modules/core/actions";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import {
  changeProjectArea,
  changeProjectPriority,
  changeProjectStatus,
  deleteProject,
  renameProject,
  restoreProject,
  updateProjectDates,
  updateProjectObjective,
} from "@/modules/projects/actions";
import { projects } from "@/modules/projects/db/schema";
import { PROJECT_ERRORS } from "@/modules/projects/project-input";
import { getDeletedProject, getProject, listProjects } from "@/modules/projects/queries";
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
async function insertRaw(values: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(projects)
    .values({ name: "Mudanza", lifeAreaId: await areaId("home"), ...values })
    .returning();
  return row;
}

async function row(id: string) {
  const [found] = await testDb.select().from(projects).where(eq(projects.id, id));
  return found;
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
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

/** Revalidates the list and the project's page. */
function expectRevalidated(id: string) {
  expect(revalidatePath).toHaveBeenCalledWith("/projects");
  expect(revalidatePath).toHaveBeenCalledWith(`/projects/${id}`);
}

describe("each edit writes its field, returns the project and revalidates", () => {
  test("renameProject normalizes the name", async () => {
    const project = await insertRaw();
    const result = await renameProject({ id: project.id, name: "  Mudanza  a \n Lima " });
    expect(result).toMatchObject({ ok: true, data: { id: project.id, name: "Mudanza a Lima" } });
    expect((await row(project.id)).name).toBe("Mudanza a Lima");
    expectRevalidated(project.id);
  });

  test("an invalid name is a field error and writes nothing", async () => {
    const project = await insertRaw();
    expect(await renameProject({ id: project.id, name: " " })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { name: [PROJECT_ERRORS.nameRequired] },
    });
    expect((await row(project.id)).name).toBe("Mudanza");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("changeProjectPriority", async () => {
    const project = await insertRaw();
    expect(await changeProjectPriority({ id: project.id, priority: "high" })).toMatchObject({
      ok: true,
      data: { priority: "high" },
    });
    expect((await row(project.id)).priority).toBe("high");
    expect(await changeProjectPriority({ id: project.id, priority: "urgent" })).toMatchObject({
      ok: false,
      fieldErrors: { priority: [PROJECT_ERRORS.priority] },
    });
  });

  test("updateProjectObjective sets and clears it", async () => {
    const project = await insertRaw();
    expect(
      await updateProjectObjective({ id: project.id, objective: " Todo  en  cajas " }),
    ).toMatchObject({ ok: true, data: { objective: "Todo en cajas" } });
    expect((await row(project.id)).objective).toBe("Todo en cajas");
    await updateProjectObjective({ id: project.id, objective: "" });
    expect((await row(project.id)).objective).toBeNull();
    expect(
      await updateProjectObjective({ id: project.id, objective: "x".repeat(281) }),
    ).toMatchObject({ ok: false, fieldErrors: { objective: [PROJECT_ERRORS.objectiveTooLong] } });
  });

  test("updateProjectDates sets both, clears them, and refuses an end before the start", async () => {
    const project = await insertRaw();
    expect(
      await updateProjectDates({ id: project.id, startDate: "2026-10-01", dueDate: "2026-10-31" }),
    ).toMatchObject({ ok: true, data: { startDate: "2026-10-01", dueDate: "2026-10-31" } });
    expect(await row(project.id)).toMatchObject({
      startDate: "2026-10-01",
      dueDate: "2026-10-31",
    });

    vi.mocked(revalidatePath).mockClear();
    expect(
      await updateProjectDates({ id: project.id, startDate: "2026-11-01", dueDate: "2026-10-31" }),
    ).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { dueDate: [PROJECT_ERRORS.dueBeforeStart] },
    });
    expect(await row(project.id)).toMatchObject({
      startDate: "2026-10-01",
      dueDate: "2026-10-31",
    });
    expect(revalidatePath).not.toHaveBeenCalled();

    // The same day is fine; empty clears.
    expect(
      (await updateProjectDates({ id: project.id, startDate: "2026-10-31", dueDate: "2026-10-31" }))
        .ok,
    ).toBe(true);
    expect(
      await updateProjectDates({ id: project.id, startDate: "", dueDate: null }),
    ).toMatchObject({ ok: true, data: { startDate: null, dueDate: null } });
  });

  test("an impossible day is a field error, never a database error", async () => {
    const project = await insertRaw();
    expect(
      await updateProjectDates({ id: project.id, startDate: "2026-02-30", dueDate: null }),
    ).toMatchObject({ ok: false, fieldErrors: { startDate: [PROJECT_ERRORS.dateInvalid] } });
  });
});

describe("status and completed_at", () => {
  test("Terminado stamps completed_at; staying keeps it; leaving clears it", async () => {
    const project = await insertRaw({ status: "active" });

    const done = await changeProjectStatus({ id: project.id, status: "done" });
    expect(done).toMatchObject({
      ok: true,
      data: { status: "done", completedAt: expect.any(Date) },
    });
    const first = (await row(project.id)).completedAt;
    expect(first).toBeInstanceOf(Date);
    expect(Math.abs(first!.getTime() - Date.now())).toBeLessThan(60_000);

    // Done again (another tab): the original date stays.
    await changeProjectStatus({ id: project.id, status: "done" });
    expect((await row(project.id)).completedAt).toEqual(first);

    const back = await changeProjectStatus({ id: project.id, status: "paused" });
    expect(back).toMatchObject({ ok: true, data: { status: "paused", completedAt: null } });
    expect(await row(project.id)).toMatchObject({ status: "paused", completedAt: null });
    expectRevalidated(project.id);
  });

  test("every state is reachable from any other (free transitions)", async () => {
    const project = await insertRaw({ status: "idea" });
    for (const status of ["canceled", "done", "maintenance", "idea", "done", "active"] as const) {
      expect((await changeProjectStatus({ id: project.id, status })).ok).toBe(true);
      const current = await row(project.id);
      expect(current.status).toBe(status);
      expect(current.completedAt === null).toBe(status !== "done");
    }
  });

  test("an unknown state is a field error", async () => {
    const project = await insertRaw();
    expect(await changeProjectStatus({ id: project.id, status: "archived" })).toMatchObject({
      ok: false,
      fieldErrors: { status: [PROJECT_ERRORS.status] },
    });
  });
});

describe("area", () => {
  test("moves to another active area", async () => {
    const project = await insertRaw();
    const work = await areaId("work");
    expect(await changeProjectArea({ id: project.id, lifeAreaId: work })).toMatchObject({
      ok: true,
      data: { area: { id: work, slug: "work", name: "Trabajo" } },
    });
    expect((await row(project.id)).lifeAreaId).toBe(work);
    expectRevalidated(project.id);
  });

  test("an archived (or missing) area is refused on its field, and the page revalidates", async () => {
    const project = await insertRaw();
    const work = await areaId("work");
    expect((await archiveLifeArea({ id: work })).ok).toBe(true);
    vi.mocked(revalidatePath).mockClear();

    for (const lifeAreaId of [work, MISSING]) {
      expect(await changeProjectArea({ id: project.id, lifeAreaId })).toEqual({
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { lifeAreaId: [PROJECT_ERRORS.areaUnavailable] },
      });
    }
    expect((await row(project.id)).lifeAreaId).toBe(await areaId("home"));
    expectRevalidated(project.id);
  });

  test("a project keeps an archived area; sending it again changes nothing", async () => {
    const project = await insertRaw();
    const home = await areaId("home");
    await testDb.update(lifeAreas).set({ archivedAt: new Date() }).where(eq(lifeAreas.id, home));

    expect(await getProject(project.id)).toMatchObject({ area: { id: home } });
    expect(await changeProjectArea({ id: project.id, lifeAreaId: home })).toMatchObject({
      ok: true,
      data: { area: { id: home } },
    });
    // Out of it, into an active one: allowed.
    const work = await areaId("work");
    expect((await changeProjectArea({ id: project.id, lifeAreaId: work })).ok).toBe(true);
    // And back into the archived one: refused.
    expect(await changeProjectArea({ id: project.id, lifeAreaId: home })).toMatchObject({
      ok: false,
      fieldErrors: { lifeAreaId: [PROJECT_ERRORS.areaUnavailable] },
    });
  });
});

describe("soft delete and undo", () => {
  test("delete stamps deleted_at: out of the list and a 404, still in the table", async () => {
    const project = await insertRaw();
    const other = await insertRaw({ name: "Otro" });

    expect(await deleteProject({ id: project.id })).toEqual({
      ok: true,
      data: { id: project.id, name: "Mudanza" },
    });
    expect((await row(project.id)).deletedAt).toBeInstanceOf(Date);
    expect((await listProjects()).map((item) => item.id)).toEqual([other.id]);
    expect(await getProject(project.id)).toBeNull();
    expect(await getDeletedProject(project.id)).toEqual({ id: project.id, name: "Mudanza" });
    expect(await getDeletedProject(other.id)).toBeNull();
    // Only the list: the page being viewed must not turn into its 404 before the client leaves.
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/projects"]]);
  });

  test("the list's undo is only offered for a recent delete (10 minutes)", async () => {
    const recent = await insertRaw({
      name: "Reciente",
      deletedAt: new Date(Date.now() - 9 * 60_000),
    });
    const old = await insertRaw({ name: "Viejo", deletedAt: new Date(Date.now() - 11 * 60_000) });
    expect(await getDeletedProject(recent.id)).toEqual({ id: recent.id, name: "Reciente" });
    expect(await getDeletedProject(old.id)).toBeNull();
    // Still restorable by the action (the window only limits the notice).
    expect((await restoreProject({ id: old.id })).ok).toBe(true);
  });

  test("malformed ids are field errors on delete and undo, never database errors", async () => {
    for (const action of [deleteProject, restoreProject]) {
      for (const id of ["not-a-uuid", "", 42, null]) {
        expect(await action({ id })).toEqual({
          ok: false,
          error: INVALID_FIELDS_MESSAGE,
          fieldErrors: { id: [PROJECT_ERRORS.notFound] },
        });
      }
      expect(await action({})).toMatchObject({ ok: false, fieldErrors: { id: expect.any(Array) } });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await getDeletedProject("not-a-uuid")).toBeNull();
  });

  test("undo restores it as it was (status, dates, area)", async () => {
    const project = await insertRaw({
      status: "done",
      completedAt: new Date("2026-09-01T12:00:00Z"),
      startDate: "2026-08-01",
      dueDate: "2026-09-01",
    });
    await deleteProject({ id: project.id });

    expect(await restoreProject({ id: project.id })).toMatchObject({
      ok: true,
      data: { id: project.id, status: "done", startDate: "2026-08-01", dueDate: "2026-09-01" },
    });
    expect(await row(project.id)).toMatchObject({
      deletedAt: null,
      completedAt: new Date("2026-09-01T12:00:00Z"),
    });
    expect((await listProjects()).map((item) => item.id)).toEqual([project.id]);
    expect(await getDeletedProject(project.id)).toBeNull();
  });

  test("undo twice is not an error; deleting twice is (it is already gone)", async () => {
    const project = await insertRaw();
    await deleteProject({ id: project.id });
    expect((await restoreProject({ id: project.id })).ok).toBe(true);
    expect((await restoreProject({ id: project.id })).ok).toBe(true);
    await deleteProject({ id: project.id });
    expect(await deleteProject({ id: project.id })).toEqual({
      ok: false,
      error: PROJECT_ERRORS.notFound,
    });
  });

  test("an area archived after the delete doesn't block the undo", async () => {
    const project = await insertRaw();
    await deleteProject({ id: project.id });
    await archiveLifeArea({ id: await areaId("home") });
    expect((await restoreProject({ id: project.id })).ok).toBe(true);
  });
});

describe("a deleted or missing project can't be edited", () => {
  test.each([
    ["renameProject", (id: string) => renameProject({ id, name: "X" })],
    ["changeProjectStatus", (id: string) => changeProjectStatus({ id, status: "done" })],
    ["changeProjectPriority", (id: string) => changeProjectPriority({ id, priority: "low" })],
    ["updateProjectObjective", (id: string) => updateProjectObjective({ id, objective: "X" })],
    ["updateProjectDates", (id: string) => updateProjectDates({ id, startDate: "2026-10-01" })],
  ])("%s", async (_, call) => {
    const project = await insertRaw({ deletedAt: new Date() });
    for (const id of [project.id, MISSING]) {
      vi.mocked(revalidatePath).mockClear();
      expect(await call(id)).toEqual({ ok: false, error: PROJECT_ERRORS.notFound });
      // The page revalidates, so it shows its 404.
      expectRevalidated(id);
    }
    expect(await row(project.id)).toMatchObject({ name: "Mudanza", status: "idea" });
  });

  test("deleteProject of a deleted or missing project (the list revalidates)", async () => {
    const project = await insertRaw({ deletedAt: new Date() });
    for (const id of [project.id, MISSING]) {
      vi.mocked(revalidatePath).mockClear();
      expect(await deleteProject({ id })).toEqual({ ok: false, error: PROJECT_ERRORS.notFound });
      expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/projects"]]);
    }
  });

  test("changeProjectArea and restoreProject of a missing project", async () => {
    expect(await changeProjectArea({ id: MISSING, lifeAreaId: await areaId("work") })).toEqual({
      ok: false,
      error: PROJECT_ERRORS.notFound,
    });
    expect(await restoreProject({ id: MISSING })).toEqual({
      ok: false,
      error: PROJECT_ERRORS.notFound,
    });
    const deleted = await insertRaw({ deletedAt: new Date() });
    expect(await changeProjectArea({ id: deleted.id, lifeAreaId: await areaId("work") })).toEqual({
      ok: false,
      error: PROJECT_ERRORS.notFound,
    });
  });
});

describe("authorization", () => {
  const ACTIONS = [
    (id: string) => renameProject({ id, name: "Hackeado" }),
    (id: string) => changeProjectStatus({ id, status: "done" }),
    (id: string) => changeProjectPriority({ id, priority: "low" }),
    async (id: string) => changeProjectArea({ id, lifeAreaId: await areaId("work") }),
    (id: string) => updateProjectObjective({ id, objective: "X" }),
    (id: string) => updateProjectDates({ id, startDate: "2026-10-01" }),
    (id: string) => deleteProject({ id }),
    (id: string) => restoreProject({ id }),
  ];

  async function expectRejected() {
    const project = await insertRaw({ priority: "high" });
    const before = await row(project.id);
    for (const action of ACTIONS) {
      expect(await action(project.id)).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await row(project.id)).toEqual(before);
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

  test("getDeletedProject redirects to /login without an owner session", async () => {
    request.headers = new Headers();
    await expect(getDeletedProject(MISSING)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});
