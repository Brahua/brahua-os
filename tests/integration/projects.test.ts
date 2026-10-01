import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { archiveLifeArea } from "@/modules/core/actions";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { createProject } from "@/modules/projects/actions";
import {
  projectDependencies,
  projectLinks,
  projectMilestones,
  projects,
} from "@/modules/projects/db/schema";
import { PROJECT_ERRORS } from "@/modules/projects/project-input";
import { getProject, listProjects } from "@/modules/projects/queries";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDatabaseUrl } from "./helpers";
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

async function areaId(slug: string): Promise<string> {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, slug));
  return area.id;
}

/** A project straight in the table (for lists and constraints), bypassing the action. */
async function insertRaw(values: Partial<typeof projects.$inferInsert> & { name: string }) {
  const [row] = await testDb
    .insert(projects)
    .values({ lifeAreaId: await areaId("home"), ...values })
    .returning();
  return row;
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

describe("createProject", () => {
  test("creates the project as an idea with medium priority and revalidates /projects", async () => {
    const work = await areaId("work");
    const result = await createProject({ name: "  Curso   AWS ", lifeAreaId: work });

    expect(result).toEqual({
      ok: true,
      data: {
        id: expect.any(String),
        name: "Curso AWS",
        objective: null,
        status: "idea",
        priority: "medium",
        dueDate: null,
        area: { id: work, slug: "work", name: "Trabajo", icon: "briefcase", color: "work" },
      },
    });
    const [row] = await testDb.select().from(projects);
    expect(row).toMatchObject({
      name: "Curso AWS",
      status: "idea",
      priority: "medium",
      lifeAreaId: work,
      completedAt: null,
      deletedAt: null,
      startDate: null,
      dueDate: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
  });

  test("starts in the state picked", async () => {
    const result = await createProject({
      name: "Web",
      lifeAreaId: await areaId("work"),
      status: "maintenance",
    });
    expect(result.ok && result.data.status).toBe("maintenance");
  });

  test("returns field errors and writes nothing", async () => {
    const result = await createProject({ name: " ", lifeAreaId: "home", status: "done" });
    expect(result).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: {
        name: [PROJECT_ERRORS.nameRequired],
        lifeAreaId: [PROJECT_ERRORS.area],
        status: [PROJECT_ERRORS.status],
      },
    });
    expect(await testDb.$count(projects)).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("a NUL in the name is a field error, never a database error", async () => {
    const result = await createProject({ name: "a\u0000b", lifeAreaId: await areaId("home") });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { name: [PROJECT_ERRORS.nameInvisible] },
    });
    expect(await testDb.$count(projects)).toBe(0);
  });

  test("an archived area is refused on its field (and the list is revalidated)", async () => {
    const home = await areaId("home");
    expect((await archiveLifeArea({ id: home })).ok).toBe(true);
    vi.mocked(revalidatePath).mockClear();

    const result = await createProject({ name: "Huerto", lifeAreaId: home });

    expect(result).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { lifeAreaId: [PROJECT_ERRORS.areaUnavailable] },
    });
    expect(await testDb.$count(projects)).toBe(0);
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
  });

  test("an area that doesn't exist is refused the same way", async () => {
    const result = await createProject({
      name: "Huerto",
      lifeAreaId: "00000000-0000-4000-8000-000000000000",
    });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { lifeAreaId: [PROJECT_ERRORS.areaUnavailable] },
    });
  });
});

describe("authorization", () => {
  async function expectRejected() {
    const home = await areaId("home");
    expect(await createProject({ name: "Huerto", lifeAreaId: home })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    // Invalid input is not even looked at: no field errors leak without a session.
    expect(await createProject({})).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    expect(await testDb.$count(projects)).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  }

  test("without a session, creating is rejected", async () => {
    request.headers = new Headers();
    await expectRejected();
  });

  test("with a forged session cookie, creating is rejected", async () => {
    request.headers = new Headers({ cookie: "better-auth.session_token=forged.signature" });
    await expectRejected();
  });

  test("with a valid session of someone who is not the owner, creating is rejected", async () => {
    request.headers = new Headers({ cookie: await sessionCookieFor(OTHER) });
    await expectRejected();
  });

  test("the queries redirect to /login without an owner session", async () => {
    request.headers = new Headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(listProjects()).rejects.toMatchObject(redirect);
    await expect(getProject("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject(
      redirect,
    );
  });
});

describe("queries", () => {
  test("listProjects leaves deleted projects out and keeps archived areas", async () => {
    const kept = await insertRaw({ name: "Visible", status: "active" });
    await insertRaw({ name: "Eliminado", deletedAt: new Date() });
    const done = await insertRaw({ name: "Hecho", status: "done", completedAt: new Date() });
    await testDb
      .update(lifeAreas)
      .set({ archivedAt: new Date() })
      .where(eq(lifeAreas.slug, "home"));

    const list = await listProjects();

    expect(list.map((project) => project.id).sort()).toEqual([kept.id, done.id].sort());
    expect(list.find((project) => project.id === kept.id)?.area).toEqual({
      id: await areaId("home"),
      slug: "home",
      name: "Hogar",
      icon: "house",
      color: "home",
    });
    expect(Object.keys(list[0]).sort()).toEqual(
      ["area", "dueDate", "id", "name", "objective", "priority", "status"].sort(),
    );
  });

  test("getProject finds a project, but not a deleted one, a missing one or a malformed id", async () => {
    const kept = await insertRaw({ name: "Visible", dueDate: "2026-12-01" });
    const deleted = await insertRaw({ name: "Eliminado", deletedAt: new Date() });

    expect(await getProject(kept.id)).toMatchObject({ name: "Visible", dueDate: "2026-12-01" });
    expect(await getProject(deleted.id)).toBeNull();
    expect(await getProject("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await getProject("not-a-uuid")).toBeNull();
  });
});

describe("CHECK constraints (defense in depth)", () => {
  const rejects = async (promise: Promise<unknown>, constraint: string) =>
    expect(promise).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "23514", constraint }),
    });

  const insertProject = async (columns: Record<string, unknown>) => {
    const values = { name: "x", life_area_id: await areaId("home"), ...columns };
    const names = sql.raw(Object.keys(values).join(", "));
    const params = sql.join(
      Object.values(values).map((value) => sql`${value}`),
      sql`, `,
    );
    return testDb.execute(sql`insert into projects (${names}) values (${params})`);
  };

  test.each([
    ["an unknown status", { status: "blocked" }, "projects_status_check"],
    ["an unknown priority", { priority: "urgent" }, "projects_priority_check"],
    ["an empty name", { name: "" }, "projects_name_length_check"],
    ["an 81-character name", { name: "a".repeat(81) }, "projects_name_length_check"],
    ["an empty objective", { objective: "" }, "projects_objective_length_check"],
    [
      "a 281-character objective",
      { objective: "a".repeat(281) },
      "projects_objective_length_check",
    ],
    ["20 001 characters of notes", { notes: "a".repeat(20_001) }, "projects_notes_length_check"],
    [
      "a due date before the start",
      { start_date: "2026-10-02", due_date: "2026-10-01" },
      "projects_dates_check",
    ],
    ["done without a completion date", { status: "done" }, "projects_completed_at_check"],
    [
      "a completion date while not done",
      { status: "active", completed_at: "2026-10-01T10:00:00Z" },
      "projects_completed_at_check",
    ],
  ])("a raw project with %s fails", async (_, columns, constraint) => {
    await rejects(insertProject(columns), constraint);
    expect(await testDb.$count(projects)).toBe(0);
  });

  test("a valid raw project passes (80 characters, dates in order, done with its date)", async () => {
    await insertProject({
      name: "ñ".repeat(80),
      objective: "a".repeat(280),
      notes: "a".repeat(20_000),
      start_date: "2026-10-01",
      due_date: "2026-10-01",
      status: "done",
      completed_at: "2026-10-01T10:00:00Z",
    });
    expect(await testDb.$count(projects)).toBe(1);
  });

  test("milestones: title 1–120, non-negative order", async () => {
    const { id } = await insertRaw({ name: "P" });
    const milestone = (title: string, sortOrder = 0) =>
      testDb.execute(
        sql`insert into project_milestones (project_id, title, sort_order) values (${id}, ${title}, ${sortOrder})`,
      );
    await rejects(milestone(""), "project_milestones_title_length_check");
    await rejects(milestone("a".repeat(121)), "project_milestones_title_length_check");
    await rejects(milestone("x", -1), "project_milestones_sort_order_check");
    await milestone("a".repeat(120));
    expect(await testDb.$count(projectMilestones)).toBe(1);
  });

  test.each([
    ["javascript:", "javascript:alert(1)"],
    ["ftp", "ftp://example.com/file"],
    ["no scheme", "example.com"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["a space inside", "https://exa mple.com"],
    ["nothing after the scheme", "https://"],
    ["too long", `https://example.com/${"a".repeat(2030)}`],
  ])("a link with %s fails", async (_, url) => {
    const { id } = await insertRaw({ name: "P" });
    await rejects(
      testDb.execute(
        sql`insert into project_links (project_id, url, sort_order) values (${id}, ${url}, 0)`,
      ),
      "project_links_url_check",
    );
  });

  test("links: http and https pass (any case); label 1–80", async () => {
    const { id } = await insertRaw({ name: "P" });
    const link = (url: string, label: string | null = null) =>
      testDb.execute(
        sql`insert into project_links (project_id, url, label, sort_order) values (${id}, ${url}, ${label}, 0)`,
      );
    await link("http://example.com");
    await link("HTTPS://example.com/a?b=c#d", "Repositorio");
    await rejects(link("https://example.com", ""), "project_links_label_length_check");
    await rejects(link("https://example.com", "a".repeat(81)), "project_links_label_length_check");
    expect(await testDb.$count(projectLinks)).toBe(2);
  });

  test("a project can't block itself; two projects can", async () => {
    const a = await insertRaw({ name: "A" });
    const b = await insertRaw({ name: "B" });
    await rejects(
      testDb.insert(projectDependencies).values({ projectId: a.id, blockedById: a.id }),
      "project_dependencies_self_check",
    );
    await testDb.insert(projectDependencies).values({ projectId: a.id, blockedById: b.id });
    expect(await testDb.$count(projectDependencies)).toBe(1);
  });
});

describe("creating while the area is being archived (two connections)", () => {
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

  test("an archive waits for a create holding FOR SHARE on the area; the project stays", async () => {
    const home = await areaId("home");
    const creator = await openTransaction();
    try {
      // What insertProject does inside its transaction: lock the active area, then insert.
      const locked = await creator.query(
        "select id from core_life_areas where id = $1 and archived_at is null for share",
        [home],
      );
      expect(locked.rowCount).toBe(1);

      const archive = archiveLifeArea({ id: home });
      expect(await stillPending(archive)).toBe(true);

      await creator.query("insert into projects (name, life_area_id) values ('Huerto', $1)", [
        home,
      ]);
      await creator.query("commit");

      expect((await archive).ok).toBe(true);
    } finally {
      await creator.end();
    }
    expect(await testDb.$count(projects, eq(projects.lifeAreaId, home))).toBe(1);
    const [area] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.id, home));
    expect(area.archivedAt).not.toBeNull();
  });

  test("a create waits for an archive in progress, then refuses the archived area", async () => {
    const home = await areaId("home");
    const archiver = await openTransaction();
    try {
      await archiver.query("update core_life_areas set archived_at = now() where id = $1", [home]);

      const create = createProject({ name: "Huerto", lifeAreaId: home });
      // FOR SHARE can't take the row while the archive's update holds it.
      expect(await stillPending(create)).toBe(true);

      await archiver.query("commit");

      expect(await create).toEqual({
        ok: false,
        error: INVALID_FIELDS_MESSAGE,
        fieldErrors: { lifeAreaId: [PROJECT_ERRORS.areaUnavailable] },
      });
    } finally {
      await archiver.end();
    }
    expect(await testDb.$count(projects)).toBe(0);
  });
});

describe("foreign keys", () => {
  test("a life area with projects can't be deleted (restrict)", async () => {
    const project = await insertRaw({ name: "P" });
    await expect(
      testDb.delete(lifeAreas).where(eq(lifeAreas.id, project.lifeAreaId)),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "23503",
        constraint: "projects_life_area_id_core_life_areas_id_fk",
      }),
    });
    expect(await testDb.$count(lifeAreas, eq(lifeAreas.id, project.lifeAreaId))).toBe(1);
  });

  test("a project needs an existing area", async () => {
    await expect(
      testDb
        .insert(projects)
        .values({ name: "P", lifeAreaId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23503" }) });
  });
});
