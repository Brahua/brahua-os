// P5: a project's notes and links, against the throwaway database.
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { INVALID_FIELDS_MESSAGE, UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { deleteProject } from "@/modules/projects/actions";
import { projectLinks, projects } from "@/modules/projects/db/schema";
import {
  addProjectLink,
  removeProjectLink,
  reorderProjectLinks,
  updateProjectLink,
} from "@/modules/projects/link-actions";
import { listProjectLinks } from "@/modules/projects/link-queries";
import { updateProjectNotes } from "@/modules/projects/notes-actions";
import { PROJECT_LINK_ERRORS } from "@/modules/projects/project-link-input";
import { PROJECT_ERRORS } from "@/modules/projects/project-input";
import { PROJECT_NOTES_ERRORS } from "@/modules/projects/project-notes-input";
import { getProject, listProjects } from "@/modules/projects/queries";
import { testDatabaseUrl } from "./helpers";
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

async function insertProject(name = "Mudanza") {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, "home"));
  const [row] = await testDb.insert(projects).values({ name, lifeAreaId: area.id }).returning();
  return row;
}

async function notesOf(id: string) {
  const [row] = await testDb
    .select({ notes: projects.notes })
    .from(projects)
    .where(eq(projects.id, id));
  return row.notes;
}

/** The links as stored: url, label and sort_order, in order. */
async function stored(projectId: string) {
  return testDb
    .select({
      id: projectLinks.id,
      url: projectLinks.url,
      label: projectLinks.label,
      sortOrder: projectLinks.sortOrder,
    })
    .from(projectLinks)
    .where(eq(projectLinks.projectId, projectId))
    .orderBy(asc(projectLinks.sortOrder));
}

async function addLinks(projectId: string, urls: string[]) {
  const ids: string[] = [];
  for (const url of urls) {
    const result = await addProjectLink({ projectId, url });
    if (!result.ok) throw new Error(result.error);
    ids.push(result.data.link.id);
  }
  return ids;
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

describe("notes", () => {
  test("saved as Markdown (normalized), shown in the detail, never in the list", async () => {
    const project = await insertProject();
    const text = "# Plan\r\n\r\n- [ ] Pintar\n\t- detalle  \n\n";
    expect(await updateProjectNotes({ id: project.id, notes: text })).toEqual({
      ok: true,
      data: { notes: "# Plan\n\n- [ ] Pintar\n\t- detalle" },
    });
    expect(await notesOf(project.id)).toBe("# Plan\n\n- [ ] Pintar\n\t- detalle");
    expect((await getProject(project.id))?.notes).toBe("# Plan\n\n- [ ] Pintar\n\t- detalle");
    // The list's summaries never load notes.
    const [summary] = await listProjects();
    expect(summary).not.toHaveProperty("notes");
    // Only the page revalidates: the list doesn't show notes.
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${project.id}`);
    expect(revalidatePath).not.toHaveBeenCalledWith("/projects");
  });

  test("raw HTML and scripts are stored as typed (rendering is what neutralizes them)", async () => {
    const project = await insertProject();
    const text = '<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror="a()">';
    await updateProjectNotes({ id: project.id, notes: text });
    expect(await notesOf(project.id)).toBe(text);
  });

  test("empty clears them (null, never an empty string)", async () => {
    const project = await insertProject();
    await updateProjectNotes({ id: project.id, notes: "Algo" });
    expect(await updateProjectNotes({ id: project.id, notes: " \n " })).toEqual({
      ok: true,
      data: { notes: null },
    });
    expect(await notesOf(project.id)).toBeNull();
  });

  test("20 000 characters fit; one more is a field error and writes nothing", async () => {
    const project = await insertProject();
    const max = "a".repeat(20_000);
    expect((await updateProjectNotes({ id: project.id, notes: max })).ok).toBe(true);
    expect(await notesOf(project.id)).toBe(max);
    vi.mocked(revalidatePath).mockClear();
    expect(await updateProjectNotes({ id: project.id, notes: `${max}b` })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { notes: [PROJECT_NOTES_ERRORS.tooLong] },
    });
    expect(await notesOf(project.id)).toBe(max);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("control characters are a field error (NUL never reaches Postgres)", async () => {
    const project = await insertProject();
    expect(await updateProjectNotes({ id: project.id, notes: "a\u0000b" })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { notes: [PROJECT_NOTES_ERRORS.control] },
    });
  });

  test("a deleted, missing or malformed project", async () => {
    const project = await insertProject();
    await deleteProject({ id: project.id });
    expect(await updateProjectNotes({ id: project.id, notes: "x" })).toEqual({
      ok: false,
      error: PROJECT_ERRORS.notFound,
    });
    expect(await notesOf(project.id)).toBeNull();
    expect(await updateProjectNotes({ id: MISSING, notes: "x" })).toEqual({
      ok: false,
      error: PROJECT_ERRORS.notFound,
    });
    expect(await updateProjectNotes({ id: "1; drop table projects", notes: "x" })).toMatchObject({
      ok: false,
      fieldErrors: { id: [PROJECT_ERRORS.notFound] },
    });
  });
});

describe("links", () => {
  test("add: http(s) only, normalized, at the end with contiguous order", async () => {
    const project = await insertProject();
    const first = await addProjectLink({
      projectId: project.id,
      url: "github.com/yo/mudanza",
      label: "  Repo ",
    });
    expect(first).toMatchObject({
      ok: true,
      data: { link: { url: "https://github.com/yo/mudanza", label: "Repo" } },
    });
    await addProjectLink({ projectId: project.id, url: "HTTP://Example.com/a b" });
    expect(await stored(project.id)).toMatchObject([
      { url: "https://github.com/yo/mudanza", label: "Repo", sortOrder: 0 },
      { url: "http://example.com/a%20b", label: null, sortOrder: 1 },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(`/projects/${project.id}`);
    expect(await listProjectLinks(project.id)).toMatchObject([
      { label: "Repo" },
      { url: "http://example.com/a%20b" },
    ]);
  });

  test.each([
    ["javascript:alert(1)", PROJECT_LINK_ERRORS.urlScheme],
    ["ftp://example.com/archivo", PROJECT_LINK_ERRORS.urlScheme],
    ["data:text/html,hola", PROJECT_LINK_ERRORS.urlScheme],
    ["mailto:yo@example.com", PROJECT_LINK_ERRORS.urlScheme],
    ["https://exa mple.com", PROJECT_LINK_ERRORS.urlInvalid],
    [`https://example.com/${"a".repeat(2048)}`, PROJECT_LINK_ERRORS.urlTooLong],
  ])("refuses %s on its field, writing nothing", async (url, error) => {
    const project = await insertProject();
    expect(await addProjectLink({ projectId: project.id, url })).toEqual({
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { url: [error] },
    });
    expect(await stored(project.id)).toEqual([]);
  });

  test("a label over 80 characters is refused", async () => {
    const project = await insertProject();
    expect(
      await addProjectLink({
        projectId: project.id,
        url: "https://a.example",
        label: "x".repeat(81),
      }),
    ).toMatchObject({ ok: false, fieldErrors: { label: [PROJECT_LINK_ERRORS.labelTooLong] } });
  });

  test("add at a position (undo) shifts the rest", async () => {
    const project = await insertProject();
    const [a, b] = await addLinks(project.id, ["https://a.example", "https://b.example"]);
    const result = await addProjectLink({
      projectId: project.id,
      url: "https://c.example",
      position: 1,
    });
    expect(result.ok).toBe(true);
    expect((await stored(project.id)).map((link) => [link.id, link.sortOrder])).toEqual([
      [a, 0],
      [result.ok ? result.data.link.id : "", 1],
      [b, 2],
    ]);
    // Past the end: at the end.
    await addProjectLink({ projectId: project.id, url: "https://d.example", position: 99 });
    expect((await stored(project.id)).map((link) => link.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  test("edit changes URL and label; the URL rules apply", async () => {
    const project = await insertProject();
    const [id] = await addLinks(project.id, ["https://a.example"]);
    expect(
      await updateProjectLink({
        projectId: project.id,
        id,
        url: "https://b.example/x",
        label: "B",
      }),
    ).toMatchObject({
      ok: true,
      data: { links: [{ id, url: "https://b.example/x", label: "B" }] },
    });
    expect(
      await updateProjectLink({ projectId: project.id, id, url: "javascript:alert(1)" }),
    ).toMatchObject({ ok: false, fieldErrors: { url: [PROJECT_LINK_ERRORS.urlScheme] } });
    expect(await stored(project.id)).toMatchObject([{ url: "https://b.example/x", label: "B" }]);
  });

  test("remove closes the gap and returns what is needed to undo", async () => {
    const project = await insertProject();
    const [a, b, c] = await addLinks(project.id, [
      "https://a.example",
      "https://b.example",
      "https://c.example",
    ]);
    expect(await removeProjectLink({ projectId: project.id, id: b })).toMatchObject({
      ok: true,
      data: { removed: { id: b, url: "https://b.example/", label: null }, position: 1 },
    });
    expect((await stored(project.id)).map((link) => [link.id, link.sortOrder])).toEqual([
      [a, 0],
      [c, 1],
    ]);
    expect(await removeProjectLink({ projectId: project.id, id: b })).toEqual({
      ok: false,
      error: PROJECT_LINK_ERRORS.notFound,
    });
  });

  describe("reorder", () => {
    test("writes the new order, contiguous", async () => {
      const project = await insertProject();
      const [a, b, c] = await addLinks(project.id, [
        "https://a.example",
        "https://b.example",
        "https://c.example",
      ]);
      const result = await reorderProjectLinks({ projectId: project.id, ids: [c, a, b] });
      expect(result).toMatchObject({
        ok: true,
        data: { links: [{ id: c }, { id: a }, { id: b }] },
      });
      expect((await stored(project.id)).map((link) => [link.id, link.sortOrder])).toEqual([
        [c, 0],
        [a, 1],
        [b, 2],
      ]);
    });

    test("a stale list (a link added or removed elsewhere) writes nothing, but revalidates", async () => {
      const project = await insertProject();
      const [a, b] = await addLinks(project.id, ["https://a.example", "https://b.example"]);
      await addLinks(project.id, ["https://c.example"]);
      vi.mocked(revalidatePath).mockClear();
      expect(await reorderProjectLinks({ projectId: project.id, ids: [b, a] })).toEqual({
        ok: false,
        error: PROJECT_LINK_ERRORS.staleOrder,
      });
      expect((await stored(project.id)).map((link) => link.id).slice(0, 2)).toEqual([a, b]);
      expect(revalidatePath).toHaveBeenCalledWith(`/projects/${project.id}`);
    });

    test.each([
      ["a duplicate", (a: string) => [a, a]],
      ["a missing link", (a: string) => [a]],
      ["an unknown id", (a: string) => [a, MISSING]],
    ])("a tampered list (%s) writes nothing", async (_name, ids) => {
      const project = await insertProject();
      const [a, b] = await addLinks(project.id, ["https://a.example", "https://b.example"]);
      expect(await reorderProjectLinks({ projectId: project.id, ids: ids(a) })).toEqual({
        ok: false,
        error: PROJECT_LINK_ERRORS.staleOrder,
      });
      expect((await stored(project.id)).map((link) => link.id)).toEqual([a, b]);
    });

    test("waits for another write to the same project's links (advisory lock)", async () => {
      const project = await insertProject();
      const [a, b] = await addLinks(project.id, ["https://a.example", "https://b.example"]);
      const other = new Client({ connectionString: testDatabaseUrl() });
      await other.connect();
      try {
        await other.query("begin");
        await other.query("select pg_advisory_xact_lock(hashtext('project_links'), hashtext($1))", [
          project.id,
        ]);
        const reorder = reorderProjectLinks({ projectId: project.id, ids: [b, a] });
        const pending = await Promise.race([
          reorder.then(() => false),
          new Promise((resolve) => setTimeout(() => resolve(true), 200)),
        ]);
        expect(pending).toBe(true);
        // Another project's links don't wait.
        const elsewhere = await insertProject("Otro");
        expect(
          (await addProjectLink({ projectId: elsewhere.id, url: "https://x.example" })).ok,
        ).toBe(true);
        await other.query("commit");
        expect((await reorder).ok).toBe(true);
      } finally {
        await other.end();
      }
      expect((await stored(project.id)).map((link) => link.id)).toEqual([b, a]);
    });

    test("concurrent adds keep the order contiguous and unique", async () => {
      const project = await insertProject();
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          addProjectLink({ projectId: project.id, url: `https://${i}.example` }),
        ),
      );
      expect(results.every((result) => result.ok)).toBe(true);
      expect((await stored(project.id)).map((link) => link.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
    });
  });

  describe("a link belongs to its project (no IDOR)", () => {
    test("another project's link can't be edited, removed or reordered through this one", async () => {
      const mine = await insertProject("Mío");
      const theirs = await insertProject("Ajeno");
      const [own] = await addLinks(mine.id, ["https://mine.example"]);
      const [foreign] = await addLinks(theirs.id, ["https://theirs.example"]);

      expect(
        await updateProjectLink({ projectId: mine.id, id: foreign, url: "https://evil.example" }),
      ).toEqual({ ok: false, error: PROJECT_LINK_ERRORS.notFound });
      expect(await removeProjectLink({ projectId: mine.id, id: foreign })).toEqual({
        ok: false,
        error: PROJECT_LINK_ERRORS.notFound,
      });
      expect(await reorderProjectLinks({ projectId: mine.id, ids: [foreign, own] })).toEqual({
        ok: false,
        error: PROJECT_LINK_ERRORS.staleOrder,
      });
      expect(await reorderProjectLinks({ projectId: mine.id, ids: [foreign] })).toEqual({
        ok: false,
        error: PROJECT_LINK_ERRORS.staleOrder,
      });
      expect(await stored(theirs.id)).toMatchObject([
        { id: foreign, url: "https://theirs.example/", sortOrder: 0 },
      ]);
      expect(await stored(mine.id)).toMatchObject([{ id: own, sortOrder: 0 }]);
    });
  });

  test("a deleted or missing project's links can't change", async () => {
    const project = await insertProject();
    const [id] = await addLinks(project.id, ["https://a.example"]);
    await deleteProject({ id: project.id });
    const notFound = { ok: false, error: PROJECT_ERRORS.notFound };
    expect(await addProjectLink({ projectId: project.id, url: "https://b.example" })).toEqual(
      notFound,
    );
    expect(
      await updateProjectLink({ projectId: project.id, id, url: "https://b.example" }),
    ).toEqual(notFound);
    expect(await removeProjectLink({ projectId: project.id, id })).toEqual(notFound);
    expect(await reorderProjectLinks({ projectId: project.id, ids: [id] })).toEqual(notFound);
    expect(await addProjectLink({ projectId: MISSING, url: "https://b.example" })).toEqual(
      notFound,
    );
    expect(await stored(project.id)).toHaveLength(1);
  });
});

describe("authorization", () => {
  async function expectRejected() {
    const project = await insertProject();
    const [link] = await testDb
      .insert(projectLinks)
      .values({ projectId: project.id, url: "https://a.example/", sortOrder: 0 })
      .returning();
    const actions = [
      () => updateProjectNotes({ id: project.id, notes: "Hackeado" }),
      () => addProjectLink({ projectId: project.id, url: "https://evil.example" }),
      () => updateProjectLink({ projectId: project.id, id: link.id, url: "https://evil.example" }),
      () => removeProjectLink({ projectId: project.id, id: link.id }),
      () => reorderProjectLinks({ projectId: project.id, ids: [link.id] }),
    ];
    for (const action of actions) {
      expect(await action()).toEqual({ ok: false, error: UNAUTHORIZED_MESSAGE });
    }
    expect(await notesOf(project.id)).toBeNull();
    expect(await stored(project.id)).toMatchObject([{ url: "https://a.example/", sortOrder: 0 }]);
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

  test("listProjectLinks redirects to /login without an owner session", async () => {
    request.headers = new Headers();
    await expect(listProjectLinks(MISSING)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
  });
});
