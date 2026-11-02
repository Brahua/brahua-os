// L1 of `learning` against the throwaway database: a track's syllabus. Check and its exact
// «Deshacer» (the instant round-trips to the millisecond), add, paste and its «Deshacer», rename,
// remove and restore in place, reorder (stale and tampered lists refused), a practice refuses
// steps, ids from another track are «not found», the track's lock, and authorization.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { learningSteps } from "@/modules/learning/db/schema";
import { LEARNING_ADVISORY_SPACE } from "@/modules/learning/lock-keys";
import { getTrack, listSteps } from "@/modules/learning/queries";
import {
  addStep,
  deleteStep,
  markStepDone,
  pasteSteps,
  renameStep,
  reorderSteps,
  undoDeleteStep,
  undoMarkStepDone,
  undoPasteSteps,
} from "@/modules/learning/steps-actions";
import type { StepItem } from "@/modules/learning/steps-input";
import { createTrack, deleteTrack } from "@/modules/learning/tracks-actions";
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
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

const MISSING = "00000000-0000-4000-8000-0000000000ff";

/** A track with a syllabus of `titles` (in progress unless told otherwise), and its steps. */
async function trackWith(titles: string[], values: Record<string, unknown> = {}) {
  const result = await createTrack({
    title: "AWS SAA",
    kind: "course",
    status: "waiting",
    syllabus: titles.join("\n"),
    ...values,
  });
  if (!result.ok) throw new Error(`createTrack failed: ${JSON.stringify(result)}`);
  const trackId = result.data.track.id;
  return { trackId, steps: await listSteps(trackId) };
}

const titles = async (trackId: string) => (await listSteps(trackId)).map((step) => step.title);

function data<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`action failed: ${result.error}`);
  return result.data;
}

describe("«Hecho» and its «Deshacer»", () => {
  test("checking advances the next step and the counts; the instant round-trips exactly", async () => {
    const { trackId, steps } = await trackWith(["Clase 1", "Clase 2", "Clase 3"]);
    const checked = data(await markStepDone({ trackId, id: steps[0].id, done: true }));
    expect(checked.previous).toBeNull();
    expect(checked.step.doneAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    const [row] = await testDb
      .select()
      .from(learningSteps)
      .where(eq(learningSteps.id, steps[0].id));
    expect(row.doneAt?.toISOString()).toBe(checked.step.doneAt);
    expect(await getTrack(trackId)).toMatchObject({
      steps: { done: 1, total: 3 },
      upcoming: [{ title: "Clase 2" }, { title: "Clase 3" }],
    });
    // Again: the first time stays.
    const again = data(await markStepDone({ trackId, id: steps[0].id, done: true }));
    expect(again.step.doneAt).toBe(checked.step.doneAt);
    expect(again.previous).toBe(checked.step.doneAt);
    // «Deshacer»: exactly that check.
    const undone = await undoMarkStepDone({
      trackId,
      id: steps[0].id,
      expected: checked.step.doneAt,
      restore: null,
    });
    expect(undone).toMatchObject({ ok: true, data: { doneAt: null } });
    expect((await getTrack(trackId))?.upcoming[0].title).toBe("Clase 1");
  });

  test("an undo after another change writes nothing (positive control: the right one does)", async () => {
    const { trackId, steps } = await trackWith(["Clase 1"]);
    const first = data(await markStepDone({ trackId, id: steps[0].id, done: true }));
    // Unchecked and checked again elsewhere: another instant.
    const later = new Date("2030-01-01T00:00:00.000Z");
    await testDb
      .update(learningSteps)
      .set({ doneAt: later })
      .where(eq(learningSteps.id, steps[0].id));
    const stale = await undoMarkStepDone({
      trackId,
      id: steps[0].id,
      expected: first.step.doneAt,
      restore: null,
    });
    expect(stale.ok).toBe(false);
    expect((await listSteps(trackId))[0].doneAt).toBe(later.toISOString());
    const right = await undoMarkStepDone({
      trackId,
      id: steps[0].id,
      expected: later.toISOString(),
      restore: null,
    });
    expect(right).toMatchObject({ ok: true, data: { doneAt: null } });
  });

  test("unchecking returns the instant it had, and its undo puts that exact instant back", async () => {
    const { trackId, steps } = await trackWith(["Clase 1"]);
    const checked = data(await markStepDone({ trackId, id: steps[0].id, done: true }));
    const unchecked = data(await markStepDone({ trackId, id: steps[0].id, done: false }));
    expect(unchecked).toMatchObject({ step: { doneAt: null }, previous: checked.step.doneAt });
    const back = await undoMarkStepDone({
      trackId,
      id: steps[0].id,
      expected: null,
      restore: unchecked.previous,
    });
    expect(back).toMatchObject({ ok: true, data: { doneAt: checked.step.doneAt } });
  });
});

describe("add and paste", () => {
  test("adds at the end with the client's id; an id already used is refused", async () => {
    const { trackId } = await trackWith(["Clase 1"]);
    const id = "00000000-0000-4000-8000-000000000a01";
    expect(await addStep({ trackId, id, title: " Clase   2 " })).toMatchObject({
      ok: true,
      data: { id, title: "Clase 2", position: 1, doneAt: null },
    });
    expect((await addStep({ trackId, id, title: "Otra" })).ok).toBe(false);
    expect(await titles(trackId)).toEqual(["Clase 1", "Clase 2"]);
  });

  test("a paste adds every line at the end, in order; its «Deshacer» removes exactly those", async () => {
    const { trackId } = await trackWith(["Clase 1"]);
    const added = data(await pasteSteps({ trackId, syllabus: "Clase 2\n\n Clase 3 \n" }));
    expect(added.map((step) => [step.title, step.position])).toEqual([
      ["Clase 2", 1],
      ["Clase 3", 2],
    ]);
    await addStep({ trackId, id: "00000000-0000-4000-8000-000000000a02", title: "Clase 4" });
    expect(data(await undoPasteSteps({ trackId, ids: added.map((step) => step.id) }))).toBe(2);
    const left = await listSteps(trackId);
    expect(left.map((step) => [step.title, step.position])).toEqual([
      ["Clase 1", 0],
      ["Clase 4", 1],
    ]);
    // Twice removes nothing more.
    expect(data(await undoPasteSteps({ trackId, ids: added.map((step) => step.id) }))).toBe(0);
  });

  test("at most 500 live steps, whether added one by one or pasted", async () => {
    const lines = Array.from({ length: 499 }, (_, i) => `P${i}`);
    const { trackId } = await trackWith(lines);
    expect((await pasteSteps({ trackId, syllabus: "A\nB" })).ok).toBe(false);
    expect(
      (await addStep({ trackId, id: "00000000-0000-4000-8000-000000000a03", title: "A" })).ok,
    ).toBe(true);
    expect(
      (await addStep({ trackId, id: "00000000-0000-4000-8000-000000000a04", title: "B" })).ok,
    ).toBe(false);
    expect(await listSteps(trackId)).toHaveLength(500);
  });

  test("a practice has no syllabus: adding or pasting is refused", async () => {
    const result = await createTrack({ title: "Inglés", kind: "practice", status: "waiting" });
    const trackId = data(result).track.id;
    expect((await pasteSteps({ trackId, syllabus: "Unidad 1" })).ok).toBe(false);
    expect(
      (await addStep({ trackId, id: "00000000-0000-4000-8000-000000000a05", title: "U1" })).ok,
    ).toBe(false);
    expect(await listSteps(trackId)).toEqual([]);
  });

  test("a deleted or missing track is not found", async () => {
    const { trackId } = await trackWith(["Clase 1"]);
    await deleteTrack({ id: trackId });
    expect((await pasteSteps({ trackId, syllabus: "X" })).ok).toBe(false);
    expect((await pasteSteps({ trackId: MISSING, syllabus: "X" })).ok).toBe(false);
  });
});

describe("rename, remove and restore", () => {
  test("renames; remove closes the gap; «Deshacer» puts it back after its neighbour", async () => {
    const { trackId, steps } = await trackWith(["Uno", "Dos", "Tres"]);
    expect(await renameStep({ trackId, id: steps[1].id, title: "Dos (bis)" })).toMatchObject({
      ok: true,
      data: { title: "Dos (bis)" },
    });
    const removed = data(await deleteStep({ trackId, id: steps[1].id }));
    expect(removed.position).toBe(1);
    expect((await listSteps(trackId)).map((step) => [step.title, step.position])).toEqual([
      ["Uno", 0],
      ["Tres", 1],
    ]);
    expect((await deleteStep({ trackId, id: steps[1].id })).ok).toBe(false);
    const back = data(
      await undoDeleteStep({ trackId, id: steps[1].id, position: 1, afterId: steps[0].id }),
    );
    expect(back.map((step) => [step.title, step.position])).toEqual([
      ["Uno", 0],
      ["Dos (bis)", 1],
      ["Tres", 2],
    ]);
    // Twice changes nothing.
    expect(
      (await undoDeleteStep({ trackId, id: steps[1].id, position: 0, afterId: null })).ok,
    ).toBe(true);
    expect(await titles(trackId)).toEqual(["Uno", "Dos (bis)", "Tres"]);
  });

  test("a step of another track is «not found» for every write (no IDOR across tracks)", async () => {
    const mine = await trackWith(["Mío"]);
    const other = await trackWith(["Ajeno"], { title: "Otro" });
    const foreign = other.steps[0].id;
    const trackId = mine.trackId;
    expect((await markStepDone({ trackId, id: foreign, done: true })).ok).toBe(false);
    expect((await renameStep({ trackId, id: foreign, title: "X" })).ok).toBe(false);
    expect((await deleteStep({ trackId, id: foreign })).ok).toBe(false);
    expect(data(await undoPasteSteps({ trackId, ids: [foreign] }))).toBe(0);
    expect((await reorderSteps({ trackId, ids: [foreign] })).ok).toBe(false);
    expect(await listSteps(other.trackId)).toMatchObject([{ title: "Ajeno", doneAt: null }]);
  });
});

describe("reorder", () => {
  test("writes the new order; a stale or tampered list writes nothing", async () => {
    const { trackId, steps } = await trackWith(["A", "B", "C"]);
    const [a, b, c] = steps.map((step: StepItem) => step.id);
    expect(data(await reorderSteps({ trackId, ids: [c, a, b] })).map((step) => step.title)).toEqual(
      ["C", "A", "B"],
    );
    // Missing one (stale), or one that isn't there: refused, nothing changes.
    expect((await reorderSteps({ trackId, ids: [a, b] })).ok).toBe(false);
    expect((await reorderSteps({ trackId, ids: [a, b, MISSING] })).ok).toBe(false);
    expect(await titles(trackId)).toEqual(["C", "A", "B"]);
  });

  test("a syllabus write waits for the track's lock (and another track's doesn't)", async () => {
    const { trackId, steps } = await trackWith(["A", "B"]);
    const other = await trackWith(["X"], { title: "Otro" });
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        LEARNING_ADVISORY_SPACE,
        trackId,
      ]);
      let settled = false;
      const blocked = reorderSteps({ trackId, ids: [steps[1].id, steps[0].id] }).then((result) => {
        settled = true;
        return result;
      });
      // Another track's syllabus goes through meanwhile.
      expect((await pasteSteps({ trackId: other.trackId, syllabus: "Y" })).ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(settled).toBe(false);
      await holder.query("commit");
      expect((await blocked).ok).toBe(true);
    } finally {
      holder.release();
    }
    expect(await titles(trackId)).toEqual(["B", "A"]);
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the read redirects to /login and every write is refused", async (_, headers) => {
    const { trackId, steps } = await trackWith(["Del owner"]);
    expect(await listSteps(trackId)).toHaveLength(1);

    request.headers = await headers();
    await expect(listSteps(trackId)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/),
    });
    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    const id = steps[0].id;
    expect(await addStep({ trackId, id: MISSING, title: "Intruso" })).toEqual(refused);
    expect(await pasteSteps({ trackId, syllabus: "Intruso" })).toEqual(refused);
    expect(await undoPasteSteps({ trackId, ids: [id] })).toEqual(refused);
    expect(await renameStep({ trackId, id, title: "X" })).toEqual(refused);
    expect(await markStepDone({ trackId, id, done: true })).toEqual(refused);
    expect(await undoMarkStepDone({ trackId, id, expected: null, restore: null })).toEqual(refused);
    expect(await deleteStep({ trackId, id })).toEqual(refused);
    expect(await undoDeleteStep({ trackId, id, position: 0, afterId: null })).toEqual(refused);
    expect(await reorderSteps({ trackId, ids: [id] })).toEqual(refused);
    const rows = await testDb.select().from(learningSteps);
    expect(rows.map((row) => [row.title, row.doneAt, row.deletedAt])).toEqual([
      ["Del owner", null, null],
    ]);
  });
});
