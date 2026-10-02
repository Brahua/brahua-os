// Checkpoint final de projects: "Cerrar proyecto" (Terminado or Cancelado, confirmed) and
// "Reabrir", through ownerAction, against the throwaway database.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { closeProject, reopenProject } from "@/modules/projects/close-actions";
import { registerProgressSource } from "@/modules/projects/contracts";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
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

async function insertRaw(values: Partial<typeof projects.$inferInsert> = {}) {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, "home"));
  const [row] = await testDb
    .insert(projects)
    .values({ name: "Mudanza", lifeAreaId: area.id, ...values })
    .returning();
  return row;
}

/** Milestones straight in the table: `done` of them checked, one more deleted (never counted). */
async function insertMilestones(projectId: string, total: number, done: number) {
  for (let i = 0; i < total + 1; i++) {
    await testDb.insert(projectMilestones).values({
      projectId,
      title: `Hito ${i + 1}`,
      sortOrder: i,
      doneAt: i < done ? new Date() : null,
      deletedAt: i === total ? new Date() : null,
    });
  }
}

async function row(id: string) {
  const [found] = await testDb.select().from(projects).where(eq(projects.id, id));
  return found;
}

function expectRevalidated(id: string) {
  expect(revalidatePath).toHaveBeenCalledWith("/projects");
  expect(revalidatePath).toHaveBeenCalledWith(`/projects/${id}`);
}

let removeSource: (() => void) | null = null;

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

afterEach(() => {
  removeSource?.();
  removeSource = null;
});

describe("closeProject", () => {
  test("Terminado stamps completed_at and reports the open milestones, without blocking", async () => {
    const project = await insertRaw({ status: "active" });
    await insertMilestones(project.id, 3, 1);

    const result = await closeProject({ id: project.id, status: "done" });
    expect(result).toMatchObject({
      ok: true,
      data: {
        project: { id: project.id, status: "done", completedAt: expect.any(Date) },
        open: { milestones: 2, tasks: 0 },
      },
    });
    const first = (await row(project.id)).completedAt;
    expect(first).toBeInstanceOf(Date);
    expect(Math.abs(first!.getTime() - Date.now())).toBeLessThan(60_000);
    expectRevalidated(project.id);

    // Done again (another tab): the original date stays.
    await closeProject({ id: project.id, status: "done" });
    expect((await row(project.id)).completedAt).toEqual(first);
  });

  test("the open count includes what the progress sources count as not done", async () => {
    const project = await insertRaw({ status: "active" });
    const other = await insertRaw({ status: "active", name: "Otro" });
    await insertMilestones(project.id, 2, 1);
    const asked: string[][] = [];
    removeSource = registerProgressSource({
      id: "fake-tasks",
      async countsFor(ids) {
        asked.push([...ids]);
        return new Map([
          [project.id, { done: 2, total: 5 }],
          [other.id, { done: 0, total: 9 }],
        ]);
      },
    });

    const result = await closeProject({ id: project.id, status: "done" });
    expect(result).toMatchObject({ ok: true, data: { open: { milestones: 1, tasks: 3 } } });
    // Only its own id is asked for.
    expect(asked).toEqual([[project.id]]);
  });

  test("nothing open: zeros", async () => {
    const project = await insertRaw({ status: "paused" });
    await insertMilestones(project.id, 2, 2);
    expect(await closeProject({ id: project.id, status: "done" })).toMatchObject({
      ok: true,
      data: { open: { milestones: 0, tasks: 0 } },
    });
  });

  test("Cancelado clears completed_at (also coming from Terminado)", async () => {
    const project = await insertRaw({ status: "done", completedAt: new Date() });
    const result = await closeProject({ id: project.id, status: "canceled" });
    expect(result).toMatchObject({
      ok: true,
      data: { project: { status: "canceled", completedAt: null } },
    });
    expect(await row(project.id)).toMatchObject({ status: "canceled", completedAt: null });
    expectRevalidated(project.id);
  });

  test("an open state is not a way to close (field error, nothing written)", async () => {
    const project = await insertRaw({ status: "active" });
    const result = await closeProject({ id: project.id, status: "paused" });
    expect(result).toMatchObject({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { status: [PROJECT_ERRORS.status] },
    });
    expect((await row(project.id)).status).toBe("active");
  });

  test("a deleted or missing project is not found", async () => {
    const deleted = await insertRaw({ status: "active", deletedAt: new Date() });
    for (const id of [deleted.id, MISSING]) {
      expect(await closeProject({ id, status: "done" })).toEqual({
        ok: false,
        error: PROJECT_ERRORS.notFound,
      });
    }
    expect((await row(deleted.id)).status).toBe("active");
  });
});

describe("reopenProject", () => {
  test("Terminado goes back to Activo and loses completed_at", async () => {
    const project = await insertRaw({ status: "done", completedAt: new Date() });
    const result = await reopenProject({ id: project.id });
    expect(result).toMatchObject({ ok: true, data: { status: "active", completedAt: null } });
    expect(await row(project.id)).toMatchObject({ status: "active", completedAt: null });
    expectRevalidated(project.id);
  });

  test("Cancelado goes back to Activo", async () => {
    const project = await insertRaw({ status: "canceled" });
    expect(await reopenProject({ id: project.id })).toMatchObject({
      ok: true,
      data: { status: "active" },
    });
  });

  test("an open project stays as it is (reopened in another tab and moved since)", async () => {
    const project = await insertRaw({ status: "paused" });
    expect(await reopenProject({ id: project.id })).toMatchObject({
      ok: true,
      data: { status: "paused" },
    });
    expect((await row(project.id)).status).toBe("paused");
  });

  test("a deleted or missing project is not found", async () => {
    const deleted = await insertRaw({
      status: "done",
      completedAt: new Date(),
      deletedAt: new Date(),
    });
    for (const id of [deleted.id, MISSING]) {
      expect(await reopenProject({ id })).toEqual({ ok: false, error: PROJECT_ERRORS.notFound });
    }
    expect((await row(deleted.id)).status).toBe("done");
  });
});

describe("authorization", () => {
  async function expectRejected() {
    const project = await insertRaw({ status: "active" });
    const closed = await insertRaw({ status: "done", completedAt: new Date(), name: "Cerrado" });
    expect(await closeProject({ id: project.id, status: "done" })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    expect(await reopenProject({ id: closed.id })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    expect((await row(project.id)).status).toBe("active");
    expect((await row(closed.id)).status).toBe("done");
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
});
