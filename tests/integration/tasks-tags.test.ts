// T4 of `tasks` against the throwaway database: tags created on first use (unique by name, also
// under concurrency), reused, removed; at most 10; capture with tags; suggestions without unused
// tags; the tag filter's condition; only visible tasks (no IDOR); authorization; the export.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { deleteProject } from "@/modules/projects/actions";
import { projects } from "@/modules/projects/db/schema";
import { completeTask, createTask, deleteTask } from "@/modules/tasks/actions";
import { taskTagLinks, taskTags, tasks } from "@/modules/tasks/db/schema";
import { getTask } from "@/modules/tasks/queries";
import { completeTaskWithNext, reopenTaskWithSpawn } from "@/modules/tasks/recurrence-actions";
import { listTaskTags, setTaskTags } from "@/modules/tasks/tag-actions";
import { getTaskTagOptions } from "@/modules/tasks/tag-queries";
import { TASK_ERRORS } from "@/modules/tasks/task-input";
import { TAGS_COPY } from "@/modules/tasks/tags-copy";
import { taskHasTag } from "@/modules/tasks/tags";
import { visibleTask } from "@/modules/tasks/tasks";
import { buildExport, type DataExport } from "@/lib/data-export";
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

async function capture(input: Record<string, unknown>) {
  const result = await createTask(input);
  if (!result.ok) throw new Error(`createTask failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function tag(id: string, tags: unknown) {
  const result = await setTaskTags({ id, tags });
  if (!result.ok) throw new Error(`setTaskTags failed: ${JSON.stringify(result)}`);
  return result.data;
}

const names = (item: { tags: { name: string }[] }) => item.tags.map((one) => one.name);

/** Names of the tags rows (the table), sorted. */
async function tagRows() {
  const rows = await testDb.select({ name: taskTags.name }).from(taskTags).orderBy(taskTags.name);
  return rows.map((row) => row.name);
}

/** Titles of the visible tasks with this tag id (the filter's condition), sorted. */
async function taggedTitles(tagId: string) {
  const rows = await testDb
    .select({ title: tasks.title })
    .from(tasks)
    .where(and(visibleTask, taskHasTag(tagId)))
    .orderBy(tasks.title);
  return rows.map((row) => row.title);
}

/** The id of a tag by name. */
async function tagId(name: string) {
  const [row] = await testDb
    .select({ id: taskTags.id })
    .from(taskTags)
    .where(eq(taskTags.name, name));
  return row.id;
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

describe("setTaskTags", () => {
  test("adds (created on first use, normalized), reuses by name, removes; revalidates", async () => {
    const one = await capture({ title: "uno" });
    const two = await capture({ title: "dos" });
    expect(names(await tag(one.id, ["  Compras ", "HOGAR"]))).toEqual(["compras", "hogar"]);
    expect(revalidatePath).toHaveBeenCalledWith("/tasks");
    expect(revalidatePath).toHaveBeenCalledWith(`/tasks/${one.id}`);
    // The same name on another task is the same tag row.
    const tagged = await tag(two.id, ["compras"]);
    expect(tagged.tags[0].id).toBe((await tag(one.id, ["compras", "hogar"])).tags[0].id);
    expect(await tagRows()).toEqual(["compras", "hogar"]);
    // The whole set: what is missing is unlinked (the tag row stays).
    expect(names(await tag(one.id, ["hogar"]))).toEqual(["hogar"]);
    expect(names(await tag(one.id, []))).toEqual([]);
    expect(await tagRows()).toEqual(["compras", "hogar"]);
    expect(await testDb.$count(taskTagLinks)).toBe(1);
  });

  test("duplicates in the input count once; setting the same set twice changes nothing", async () => {
    const one = await capture({ title: "uno" });
    expect(names(await tag(one.id, ["a", "A", " a "]))).toEqual(["a"]);
    expect(names(await tag(one.id, ["a"]))).toEqual(["a"]);
    expect(await testDb.$count(taskTagLinks)).toBe(1);
  });

  test("at most 10: an eleventh is refused and nothing changes", async () => {
    const one = await capture({ title: "uno" });
    const ten = Array.from({ length: 10 }, (_, index) => `t${index}`);
    expect(names(await tag(one.id, ten))).toHaveLength(10);
    expect(await setTaskTags({ id: one.id, tags: [...ten, "t10"] })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { tags: [TAGS_COPY.errors.tooMany] },
    });
    expect(await testDb.$count(taskTagLinks)).toBe(10);
    expect(await tagRows()).not.toContain("t10");
  });

  test("invalid names are field errors and write nothing", async () => {
    const one = await capture({ title: "uno" });
    for (const bad of ["", "a".repeat(31), "a,b", "x‮y", 3]) {
      const result = await setTaskTags({ id: one.id, tags: ["ok", bad] });
      expect(result).toMatchObject({ ok: false, fieldErrors: { "tags.1": [expect.any(String)] } });
    }
    expect(await setTaskTags({ id: one.id, tags: "compras" })).toMatchObject({ ok: false });
    expect(await testDb.$count(taskTags)).toBe(0);
  });

  test("the database refuses an uppercase or too long tag even without the action", async () => {
    await expect(testDb.insert(taskTags).values({ name: "Compras" })).rejects.toThrow();
    await expect(testDb.insert(taskTags).values({ name: "a".repeat(31) })).rejects.toThrow();
  });

  test("a tag edit stamps updated_at (T3: a touched spawn is kept on Deshacer)", async () => {
    const one = await capture({ title: "uno" });
    const [before] = await testDb.select().from(tasks).where(eq(tasks.id, one.id));
    expect(before.updatedAt).toEqual(before.createdAt);
    await tag(one.id, ["hogar"]);
    const [after] = await testDb.select().from(tasks).where(eq(tasks.id, one.id));
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  test("names JS lowercases (İ, Σ, ǅ) pass the database's lower() CHECK", async () => {
    const one = await capture({ title: "uno" });
    expect(names(await tag(one.id, ["İSTANBUL", "ΟΔΟΣ", "ǅemal"])).sort()).toEqual(
      ["i\u0307stanbul", "οδος".slice(0, 3) + "ς", "ǆemal"].sort(),
    );
  });

  test("a done task can be tagged", async () => {
    const one = await capture({ title: "uno" });
    await completeTask({ id: one.id });
    expect(names(await tag(one.id, ["hecho"]))).toEqual(["hecho"]);
  });

  test("no IDOR: a missing, deleted, or deleted-project task is not found and nothing is written", async () => {
    const gone = await capture({ title: "borrada" });
    await deleteTask({ id: gone.id });
    const [area] = await testDb.select().from(lifeAreas).where(eq(lifeAreas.slug, "home"));
    const [project] = await testDb
      .insert(projects)
      .values({ name: "Cocina", lifeAreaId: area.id, status: "active" })
      .returning();
    const hidden = await capture({ title: "en proyecto", projectId: project.id });
    await deleteProject({ id: project.id });
    for (const id of [MISSING, gone.id, hidden.id]) {
      expect(await setTaskTags({ id, tags: ["x"] })).toEqual({
        ok: false,
        error: TASK_ERRORS.notFound,
      });
    }
    expect(await setTaskTags({ id: "not-a-uuid", tags: ["x"] })).toMatchObject({
      ok: false,
      fieldErrors: { id: [expect.any(String)] },
    });
    expect(await testDb.$count(taskTags)).toBe(0);
    expect(await testDb.$count(taskTagLinks)).toBe(0);
  });
});

describe("created on first use, under concurrency", () => {
  test("many writers creating the same new tags at once all succeed with one row each", async () => {
    const created = await Promise.all(
      Array.from({ length: 8 }, (_, index) => capture({ title: `t${index}` })),
    );
    // Overlapping sets in different orders: sorted inserts, so no deadlock either.
    const results = await Promise.all(
      created.map((task, index) =>
        setTaskTags({ id: task.id, tags: index % 2 ? ["nueva", "otra"] : ["otra", "nueva"] }),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await tagRows()).toEqual(["nueva", "otra"]);
    expect(await testDb.$count(taskTagLinks)).toBe(16);
  });

  test("a create waits for another one's uncommitted tag and then reuses it (ON CONFLICT)", async () => {
    const task = await capture({ title: "uno" });
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("insert into task_tags (name) values ('carrera')");
      const pending = setTaskTags({ id: task.id, tags: ["carrera"] });
      await waitForBlockedBackends(1);
      await holder.query("commit");
      const result = await pending;
      expect(result.ok).toBe(true);
    } finally {
      holder.release();
    }
    expect(await tagRows()).toEqual(["carrera"]);
    expect(await testDb.$count(taskTagLinks)).toBe(1);
  });

  test("…and if the other one rolls back, it creates the tag itself (positive control)", async () => {
    const task = await capture({ title: "uno" });
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("insert into task_tags (name) values ('carrera')");
      const pending = setTaskTags({ id: task.id, tags: ["carrera"] });
      await waitForBlockedBackends(1);
      await holder.query("rollback");
      expect((await pending).ok).toBe(true);
    } finally {
      holder.release();
    }
    expect(await tagRows()).toEqual(["carrera"]);
  });

  test("two writes to the same task take turns (row lock): never more than 10", async () => {
    const task = await capture({ title: "uno" });
    const a = Array.from({ length: 10 }, (_, index) => `a${index}`);
    const b = Array.from({ length: 10 }, (_, index) => `b${index}`);
    const holder = await testDb.$client.connect();
    let results;
    try {
      // Holds the task's row lock: both writes must queue behind it (and then each other).
      await holder.query("begin");
      await holder.query("select id from tasks where id = $1 for update", [task.id]);
      const pending = Promise.all([
        setTaskTags({ id: task.id, tags: a }),
        setTaskTags({ id: task.id, tags: b }),
      ]);
      await waitForBlockedBackends(2);
      await holder.query("commit");
      results = await pending;
    } finally {
      holder.release();
    }
    expect(results.every((result) => result.ok)).toBe(true);
    const links = await testDb.$count(taskTagLinks, eq(taskTagLinks.taskId, task.id));
    expect(links).toBe(10);
  });
});

describe("capture with tags", () => {
  test("the task and its tags in one go (created or reused)", async () => {
    await tag((await capture({ title: "antes" })).id, ["hogar"]);
    const task = await capture({ title: "pilas", tags: ["Compras", "hogar"] });
    expect(names(task)).toEqual(["compras", "hogar"]);
    expect(await tagRows()).toEqual(["compras", "hogar"]);
  });

  test("an invalid tag refuses the capture: no task, no tag", async () => {
    expect(await createTask({ title: "pilas", tags: ["ok", "a".repeat(31)] })).toMatchObject({
      ok: false,
      fieldErrors: { "tags.1": [TAGS_COPY.errors.tooLong] },
    });
    expect(
      await createTask({ title: "pilas", tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }),
    ).toMatchObject({ ok: false, fieldErrors: { tags: [TAGS_COPY.errors.tooMany] } });
    expect(await testDb.$count(tasks)).toBe(0);
    expect(await testDb.$count(taskTags)).toBe(0);
  });

  test("a refused placement writes no tag either (same transaction)", async () => {
    expect(await createTask({ title: "x", lifeAreaId: MISSING, tags: ["nueva"] })).toMatchObject({
      ok: false,
    });
    expect(await testDb.$count(taskTags)).toBe(0);
  });
});

describe("suggestions and the filter", () => {
  test("in use only, the most used first, then by name; unused and hidden ones are left out", async () => {
    const a = await capture({ title: "a" });
    const b = await capture({ title: "b" });
    const c = await capture({ title: "c" });
    await tag(a.id, ["hogar", "compras"]);
    await tag(b.id, ["hogar", "zeta"]);
    await tag(c.id, ["solo-borrada"]);
    await deleteTask({ id: c.id });
    await tag(a.id, ["hogar"]); // "compras" is now unused.
    expect(await listTaskTags({})).toEqual({ ok: true, data: ["hogar", "zeta"] });
    expect(await getTaskTagOptions()).toEqual([
      { id: await tagId("hogar"), name: "hogar" },
      { id: await tagId("zeta"), name: "zeta" },
    ]);
    expect(await tagRows()).toEqual(["compras", "hogar", "solo-borrada", "zeta"]);
  });

  test("a done task's tags are still in use", async () => {
    const a = await capture({ title: "a" });
    await tag(a.id, ["hecha"]);
    await completeTask({ id: a.id });
    expect((await getTaskTagOptions()).map((option) => option.name)).toEqual(["hecha"]);
  });

  test("taskHasTag: the visible tasks with that tag (by id), each once", async () => {
    const a = await capture({ title: "a" });
    const b = await capture({ title: "b" });
    const c = await capture({ title: "c" });
    const d = await capture({ title: "d" });
    await tag(a.id, ["hogar", "compras"]);
    await tag(b.id, ["hogar"]);
    await tag(c.id, ["hogares"]);
    await tag(d.id, ["hogar"]);
    await deleteTask({ id: d.id });
    expect(await taggedTitles(await tagId("hogar"))).toEqual(["a", "b"]);
    expect(await taggedTitles(await tagId("compras"))).toEqual(["a"]);
    expect(await taggedTitles(MISSING)).toEqual([]);
  });
});

describe("recurrence (T3)", () => {
  async function complete(id: string) {
    const result = await completeTaskWithNext({ id });
    if (!result.ok) throw new Error(`complete failed: ${JSON.stringify(result)}`);
    return result.data;
  }

  async function reopen(id: string) {
    const result = await reopenTaskWithSpawn({ id });
    if (!result.ok) throw new Error(`reopen failed: ${JSON.stringify(result)}`);
    return result.data;
  }

  const recurring = () =>
    capture({
      title: "regar",
      recurrence: { kind: "every_days", interval: 3 },
      tags: ["plantas", "hogar"],
    });

  test("the spawned occurrence carries the same tags", async () => {
    const task = await recurring();
    const { next } = await complete(task.id);
    expect(names((await getTask(next!.id))!)).toEqual(["hogar", "plantas"]);
  });

  test("an untouched spawn is removed on Deshacer (positive control)", async () => {
    const task = await recurring();
    const { next } = await complete(task.id);
    expect(await reopen(task.id)).toMatchObject({ spawn: "removed" });
    expect(await getTask(next!.id)).toBeNull();
  });

  test("tagging the spawn counts as touching it: Deshacer keeps it, with its tags", async () => {
    const task = await recurring();
    const { next } = await complete(task.id);
    await tag(next!.id, ["plantas", "hogar", "jardín"]);
    expect(await reopen(task.id)).toMatchObject({ spawn: "kept", task: { doneAt: null } });
    expect(names((await getTask(next!.id))!)).toEqual(["hogar", "jardín", "plantas"]);
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    [
      "a forged cookie",
      async () => new Headers({ cookie: "better-auth.session_token=forged.value" }),
    ],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the tag actions are refused and nothing changes", async (_, headers) => {
    const task = await capture({ title: "x", tags: ["hogar"] });
    request.headers = await headers();
    expect(await setTaskTags({ id: task.id, tags: ["otra"] })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    expect(await createTask({ title: "y", tags: ["otra"] })).toEqual({
      ok: false,
      error: UNAUTHORIZED_MESSAGE,
    });
    expect(await listTaskTags({})).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    expect(await tagRows()).toEqual(["hogar"]);
    expect(await testDb.$count(taskTagLinks)).toBe(1);
  });
});

describe("export", () => {
  test("pnpm db:export carries the tags and their links", async () => {
    const task = await capture({ title: "x", tags: ["hogar", "compras"] });
    const data = JSON.parse(JSON.stringify(await buildExport(testDb, new Date()))) as DataExport;
    expect(data.tables.task_tags.rows.map((row) => row.name).sort()).toEqual(["compras", "hogar"]);
    expect(data.tables.task_tag_links.rows).toHaveLength(2);
    expect(data.tables.task_tag_links.rows.every((row) => row.task_id === task.id)).toBe(true);
  });
});

/** Waits until `count` backends of this database are blocked on a lock (any kind). */
async function waitForBlockedBackends(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await testDb.$client.query<{ blocked: number }>(
      `select count(*)::int as blocked from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (result.rows[0].blocked >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${count} blocked backends`);
}
