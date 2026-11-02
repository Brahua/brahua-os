// L2 of `learning` against the throwaway database: the sessions table's CHECKs and the partial
// unique index with raw inserts, the timer (one running in the whole app, also with two «Estudiar»
// at once, with a positive control, and the timer lock), the 4 h confirmation, exact «Deshacer» of
// start, stop and remove, «Anotar tiempo» in the week of the day chosen, the week's minutes,
// authorization and the export.
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_MESSAGE } from "@/lib/action-result";
import { buildExport } from "@/lib/data-export";
import { ownerDateKey } from "@/lib/time";
import { seed } from "@/modules/core/seed";
import { learningSessions } from "@/modules/learning/db/schema";
import { LEARNING_ADVISORY_SPACE, LEARNING_TIMER_KEY } from "@/modules/learning/lock-keys";
import { addDays, weekBounds } from "@/modules/learning/pace";
import { getRunningSession, getTrackMinutes, listTrackSessions } from "@/modules/learning/queries";
import { selectTrackMinutes } from "@/modules/learning/sessions";
import {
  logSession,
  removeSession,
  restoreSession,
  startSession,
  stopSession,
  undoStartSession,
  undoStopSession,
} from "@/modules/learning/sessions-actions";
import { SESSION_ERRORS } from "@/modules/learning/sessions-copy";
import type { StartResult, StoppedSession } from "@/modules/learning/sessions-input";
import { changeStatus, createTrack, deleteTrack } from "@/modules/learning/tracks-actions";
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
const HOUR = 3_600_000;

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

async function track(title = "AWS SAA", values: Record<string, unknown> = {}): Promise<string> {
  const result = await createTrack({ title, kind: "course", status: "waiting", ...values });
  if (!result.ok) throw new Error(`createTrack failed: ${JSON.stringify(result)}`);
  return result.data.track.id;
}

async function start(trackId: string, stopMinutes?: number): Promise<StartResult> {
  const result = await startSession({ trackId, stopMinutes });
  if (!result.ok) throw new Error(`startSession failed: ${JSON.stringify(result)}`);
  return result.data;
}

/** A running timer that started `hours` ago (raw: the clock can't be moved). */
async function runningSince(trackId: string, hours: number): Promise<string> {
  const [row] = await testDb
    .insert(learningSessions)
    .values({ trackId, source: "timer", startedAt: new Date(Date.now() - hours * HOUR) })
    .returning({ id: learningSessions.id });
  return row.id;
}

const rowOf = async (id: string) =>
  (await testDb.select().from(learningSessions).where(eq(learningSessions.id, id)))[0];

const runningRows = () =>
  testDb
    .select()
    .from(learningSessions)
    .where(and(isNull(learningSessions.endedAt), isNull(learningSessions.deletedAt)));

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

describe("the table's own CHECKs and the running index", () => {
  const START = new Date("2026-11-02T15:00:00.000Z");
  const LATER = new Date("2026-11-02T16:00:00.000Z");
  test.each([
    [
      "an unknown source",
      { source: "pomodoro", endedAt: LATER, minutes: 60 },
      "learning_sessions_source_check",
    ],
    ["minutes while running", { minutes: 10 }, "learning_sessions_minutes_check"],
    ["ended without minutes", { endedAt: LATER }, "learning_sessions_minutes_check"],
    ["0 minutes", { endedAt: LATER, minutes: 0 }, "learning_sessions_minutes_check"],
    ["601 minutes", { endedAt: LATER, minutes: 601 }, "learning_sessions_minutes_check"],
    [
      "ended before it started",
      { endedAt: new Date("2026-11-02T14:00:00.000Z"), minutes: 10 },
      "learning_sessions_ended_check",
    ],
    ["a manual one running", { source: "manual" }, "learning_sessions_manual_check"],
  ] as const)("%s is refused", async (_, patch, constraint) => {
    const trackId = await track();
    const result = await violation(() =>
      testDb.insert(learningSessions).values({
        trackId,
        source: "timer",
        startedAt: START,
        ...patch,
      } as typeof learningSessions.$inferInsert),
    );
    expect(result).toEqual({ code: "23514", constraint });
  });

  test("a valid ended session goes in (positive control)", async () => {
    const trackId = await track();
    const [row] = await testDb
      .insert(learningSessions)
      .values({ trackId, source: "manual", startedAt: START, endedAt: LATER, minutes: 60 })
      .returning();
    expect(row).toMatchObject({ minutes: 60, deletedAt: null });
  });

  test("a second running timer is refused; ended or deleted ones don't count", async () => {
    const a = await track("A");
    const b = await track("B");
    // Positive control: one running, plus an ended one and a deleted running one, go in.
    await runningSince(a, 1);
    await testDb.insert(learningSessions).values([
      { trackId: b, source: "manual", startedAt: new Date(), endedAt: new Date(), minutes: 30 },
      { trackId: b, source: "timer", startedAt: new Date(), deletedAt: new Date() },
    ]);
    expect(await violation(() => runningSince(b, 0))).toEqual({
      code: "23505",
      constraint: "learning_sessions_running_unique",
    });
  });

  test("a session can't point at a track that doesn't exist (23503)", async () => {
    expect(
      await violation(() => runningSince("00000000-0000-4000-8000-000000000999", 0)),
    ).toMatchObject({ code: "23503" });
  });
});

describe("the timer", () => {
  test("«Estudiar» starts it; again on the same track changes nothing", async () => {
    const a = await track();
    const first = await start(a);
    expect(first.stopped).toBeNull();
    expect(await getRunningSession()).toEqual(first.session);
    const again = await start(a);
    expect(again).toEqual({ session: first.session, stopped: null });
    expect(await runningRows()).toHaveLength(1);
  });

  test("starting another track stops and saves the running one in the same request", async () => {
    const a = await track("A");
    const b = await track("B");
    const id = await runningSince(a, 0.7); // 42 min
    const result = await start(b);
    expect(result.stopped).toMatchObject({ id, trackId: a, trackTitle: "A", minutes: 42 });
    const stopped = await rowOf(id);
    expect(stopped.endedAt?.toISOString()).toBe(result.stopped?.endedAt);
    expect(result.session.trackId).toBe(b);
    expect((await runningRows()).map((row) => row.trackId)).toEqual([b]);
  });

  test("two «Estudiar» at once: one running timer, and two tracks at once still one", async () => {
    const a = await track("A");
    const b = await track("B");
    const same = await Promise.all([startSession({ trackId: a }), startSession({ trackId: a })]);
    expect(same.map((result) => result.ok)).toEqual([true, true]);
    expect(await runningRows()).toHaveLength(1);
    expect(await testDb.select().from(learningSessions)).toHaveLength(1);
    // Two tracks at once: both succeed in turn (the second stops the first's), one runs.
    const both = await Promise.all([startSession({ trackId: a }), startSession({ trackId: b })]);
    expect(both.every((result) => result.ok)).toBe(true);
    expect(await runningRows()).toHaveLength(1);
    // Positive control: rows did get written (the first one stopped, a second started).
    expect((await testDb.select().from(learningSessions)).length).toBeGreaterThanOrEqual(2);
  });

  test("«Estudiar» waits for the timer lock", async () => {
    const a = await track();
    const holder = await testDb.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock($1, hashtext($2))", [
        LEARNING_ADVISORY_SPACE,
        LEARNING_TIMER_KEY,
      ]);
      let settled = false;
      const blocked = startSession({ trackId: a }).then((result) => {
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

  test("«Detener» saves rounded minutes, at least 1, and «Deshacer» runs it again", async () => {
    const a = await track();
    const { session } = await start(a);
    const result = await stopSession({ id: session.id });
    expect(result).toMatchObject({ ok: true, data: { id: session.id, minutes: 1 } });
    const stopped = (result as { data: StoppedSession }).data;
    expect((await rowOf(session.id)).endedAt?.toISOString()).toBe(stopped.endedAt);
    // Stopping it again: it isn't running.
    expect(await stopSession({ id: session.id })).toEqual({
      ok: false,
      error: SESSION_ERRORS.notRunning,
    });
    const undone = await undoStopSession({
      id: stopped.id,
      endedAt: stopped.endedAt,
      minutes: stopped.minutes,
    });
    expect(undone.ok).toBe(true);
    expect(await rowOf(session.id)).toMatchObject({ endedAt: null, minutes: null });
    // A second «Deshacer» finds it changed and writes nothing.
    expect(
      (
        await undoStopSession({
          id: stopped.id,
          endedAt: stopped.endedAt,
          minutes: stopped.minutes,
        })
      ).ok,
    ).toBe(false);
  });

  test("the stop's «Deshacer» refuses while another timer runs", async () => {
    const a = await track("A");
    const b = await track("B");
    const { session } = await start(a);
    const stopped = (await stopSession({ id: session.id })) as { data: StoppedSession };
    await start(b);
    expect(
      await undoStopSession({
        id: stopped.data.id,
        endedAt: stopped.data.endedAt,
        minutes: stopped.data.minutes,
      }),
    ).toEqual({ ok: false, error: SESSION_ERRORS.changed });
    expect((await runningRows()).map((row) => row.trackId)).toEqual([b]);
  });

  test("the start's «Deshacer» removes that session and runs the stopped one again, exactly", async () => {
    const a = await track("A");
    const b = await track("B");
    const id = await runningSince(a, 1);
    const started = await start(b);
    const undo = {
      id: started.session.id,
      stopped: {
        id,
        endedAt: started.stopped!.endedAt,
        minutes: started.stopped!.minutes,
      },
    };
    expect((await undoStartSession(undo)).ok).toBe(true);
    expect(await rowOf(started.session.id)).toMatchObject({ endedAt: null });
    expect((await rowOf(started.session.id)).deletedAt).not.toBeNull();
    expect(await rowOf(id)).toMatchObject({ endedAt: null, minutes: null, deletedAt: null });
    expect((await runningRows()).map((row) => row.id)).toEqual([id]);
    // Twice: nothing changes.
    expect(await undoStartSession(undo)).toEqual({ ok: false, error: SESSION_ERRORS.changed });
  });

  test("the start's «Deshacer» writes nothing once the stopped session changed", async () => {
    const a = await track("A");
    const b = await track("B");
    const id = await runningSince(a, 1);
    const started = await start(b);
    await testDb.update(learningSessions).set({ minutes: 5 }).where(eq(learningSessions.id, id));
    const result = await undoStartSession({
      id: started.session.id,
      stopped: { id, endedAt: started.stopped!.endedAt, minutes: started.stopped!.minutes },
    });
    expect(result).toEqual({ ok: false, error: SESSION_ERRORS.changed });
    expect((await runningRows()).map((row) => row.id)).toEqual([started.session.id]);
  });

  test("a finished track starts no timer; a deleted one doesn't exist", async () => {
    const a = await track();
    await changeStatus({ id: a, to: "done" });
    expect(await startSession({ trackId: a })).toEqual({
      ok: false,
      error: SESSION_ERRORS.trackDone,
    });
    const b = await track("B");
    await deleteTrack({ id: b });
    expect((await startSession({ trackId: b })).ok).toBe(false);
    expect(await runningRows()).toHaveLength(0);
  });

  test("a timer whose track was deleted isn't shown, and starting another one stops it", async () => {
    const a = await track("A");
    const b = await track("B");
    const id = await runningSince(a, 0.5);
    await deleteTrack({ id: a });
    expect(await getRunningSession()).toBeNull();
    const result = await start(b);
    expect(result.stopped?.id).toBe(id);
  });
});

describe("more than 4 h", () => {
  test("«Detener» asks for the minutes, never more than it ran, and saves the corrected ones", async () => {
    const a = await track();
    const id = await runningSince(a, 5.2); // 312 min
    const asked = await stopSession({ id });
    expect(asked).toMatchObject({
      ok: false,
      fieldErrors: { minutes: [SESSION_ERRORS.confirmNeeded] },
    });
    const tooMany = await stopSession({ id, minutes: 320 });
    expect(tooMany).toMatchObject({ ok: false, fieldErrors: { minutes: [expect.any(String)] } });
    expect(await rowOf(id)).toMatchObject({ endedAt: null });
    expect(await stopSession({ id, minutes: 120 })).toMatchObject({
      ok: true,
      data: { minutes: 120 },
    });
  });

  test("exactly under 4 h saves without asking (positive control)", async () => {
    const a = await track();
    const id = await runningSince(a, 3.99);
    expect(await stopSession({ id })).toMatchObject({ ok: true, data: { minutes: 239 } });
  });

  test("«Estudiar» on another track asks for the long one's minutes first", async () => {
    const a = await track("A");
    const b = await track("B");
    const id = await runningSince(a, 6);
    expect(await startSession({ trackId: b })).toMatchObject({
      ok: false,
      fieldErrors: { stopMinutes: [SESSION_ERRORS.confirmNeeded] },
    });
    expect((await runningRows()).map((row) => row.id)).toEqual([id]);
    const result = await start(b, 90);
    expect(result.stopped).toMatchObject({ id, minutes: 90 });
  });
});

describe("«Anotar tiempo» and the week", () => {
  test("today and yesterday count in their weeks; the future and 31 days back are refused", async () => {
    const a = await track();
    const now = new Date();
    const today = ownerDateKey(now);
    const yesterday = addDays(today, -1);
    const one = await logSession({ trackId: a, minutes: 30, day: today });
    const two = await logSession({ trackId: a, minutes: 45, day: yesterday });
    expect([one.ok, two.ok]).toEqual([true, true]);
    const created = (two as { data: { id: string; startedAt: string } }).data;
    expect(ownerDateKey(new Date(created.startedAt))).toBe(yesterday);
    expect(await rowOf(created.id)).toMatchObject({ source: "manual", minutes: 45 });

    const sameWeek =
      weekBounds(now).weekStart === weekBounds(new Date(created.startedAt)).weekStart;
    expect(await getTrackMinutes(now)).toEqual({ [a]: { week: sameWeek ? 75 : 30, total: 75 } });

    for (const day of [addDays(today, 1), addDays(today, -31)]) {
      expect(await logSession({ trackId: a, minutes: 30, day })).toMatchObject({
        ok: false,
        fieldErrors: { day: [SESSION_ERRORS.day] },
      });
    }
    expect(await logSession({ trackId: a, minutes: 30, day: addDays(today, -30) })).toMatchObject({
      ok: true,
    });
    expect(await logSession({ trackId: a, minutes: 601, day: today })).toMatchObject({
      ok: false,
      fieldErrors: { minutes: [SESSION_ERRORS.minutes] },
    });
  });

  test("the week's minutes cut at Lima's Monday 00:00 by the start; running and deleted don't count", async () => {
    const a = await track();
    const at = (iso: string, minutes: number) => ({
      trackId: a,
      source: "timer" as const,
      startedAt: new Date(iso),
      endedAt: new Date(Date.parse(iso) + minutes * 60_000),
      minutes,
    });
    await testDb.insert(learningSessions).values([
      at("2026-11-02T05:00:00.000Z", 10), // Monday 00:00 Lima: this week
      at("2026-11-02T04:30:00.000Z", 60), // Sunday 23:30 Lima, ends on Monday: last week
      at("2026-11-09T04:59:00.000Z", 20), // Sunday 23:59 Lima: this week
      { ...at("2026-11-03T15:00:00.000Z", 99), deletedAt: new Date() },
    ]);
    await testDb
      .insert(learningSessions)
      .values({ trackId: a, source: "timer", startedAt: new Date("2026-11-04T15:00:00Z") });
    const minutes = await selectTrackMinutes(testDb, weekBounds(new Date("2026-11-05T15:00:00Z")));
    expect(minutes).toEqual({ [a]: { week: 30, total: 90 } });
  });

  test("the track's page lists its ended sessions, newest first", async () => {
    const a = await track("A");
    const b = await track("B");
    const today = ownerDateKey(new Date());
    await logSession({ trackId: a, minutes: 20, day: addDays(today, -2) });
    await logSession({ trackId: a, minutes: 40, day: today });
    await logSession({ trackId: b, minutes: 50, day: today });
    await start(a);
    const sessions = await listTrackSessions(a, new Date());
    expect(sessions.map((session) => session.minutes)).toEqual([40, 20]);
  });
});

describe("«Quitar» and its «Deshacer»", () => {
  test("out of the list and the minutes, back with the same id; twice changes nothing", async () => {
    const a = await track();
    const today = ownerDateKey(new Date());
    const logged = await logSession({ trackId: a, minutes: 30, day: today });
    const { id } = (logged as { data: { id: string } }).data;
    expect((await removeSession({ trackId: a, id })).ok).toBe(true);
    expect(await listTrackSessions(a, new Date())).toEqual([]);
    expect(await getTrackMinutes(new Date(), a)).toEqual({});
    expect((await removeSession({ trackId: a, id })).ok).toBe(false);
    expect((await restoreSession({ trackId: a, id })).ok).toBe(true);
    expect(await getTrackMinutes(new Date(), a)).toEqual({ [a]: { week: 30, total: 30 } });
    expect(await restoreSession({ trackId: a, id })).toEqual({
      ok: false,
      error: SESSION_ERRORS.changed,
    });
  });

  test("another track's id is not found, and a running timer can't be removed", async () => {
    const a = await track("A");
    const b = await track("B");
    const logged = await logSession({ trackId: a, minutes: 30, day: ownerDateKey(new Date()) });
    const { id } = (logged as { data: { id: string } }).data;
    expect((await removeSession({ trackId: b, id })).ok).toBe(false);
    const { session } = await start(a);
    expect((await removeSession({ trackId: a, id: session.id })).ok).toBe(false);
    expect((await rowOf(id)).deletedAt).toBeNull();
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the reads redirect to /login and every write is refused", async (_, headers) => {
    const a = await track();
    const { session } = await start(a);
    // Positive control: the owner reads.
    expect(await getRunningSession()).not.toBeNull();

    request.headers = await headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(getRunningSession()).rejects.toMatchObject(redirect);
    await expect(getTrackMinutes(new Date())).rejects.toMatchObject(redirect);
    await expect(listTrackSessions(a, new Date())).rejects.toMatchObject(redirect);
    const refused = { ok: false, error: UNAUTHORIZED_MESSAGE };
    const today = ownerDateKey(new Date());
    expect(await startSession({ trackId: a })).toEqual(refused);
    expect(await stopSession({ id: session.id })).toEqual(refused);
    expect(await undoStartSession({ id: session.id })).toEqual(refused);
    expect(
      await undoStopSession({ id: session.id, endedAt: new Date().toISOString(), minutes: 5 }),
    ).toEqual(refused);
    expect(await logSession({ trackId: a, minutes: 30, day: today })).toEqual(refused);
    expect(await removeSession({ trackId: a, id: session.id })).toEqual(refused);
    expect(await restoreSession({ trackId: a, id: session.id })).toEqual(refused);
    const rows = await testDb.select().from(learningSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: session.id, endedAt: null, deletedAt: null });
  });
});

describe("export", () => {
  test("every session is exported, running and removed ones included", async () => {
    const a = await track();
    const logged = await logSession({ trackId: a, minutes: 30, day: ownerDateKey(new Date()) });
    await removeSession({ trackId: a, id: (logged as { data: { id: string } }).data.id });
    await start(a);
    const data = await buildExport(testDb, new Date());
    const sessions = data.tables.learning_sessions;
    expect(sessions.rowCount).toBe(2);
    expect(
      sessions.rows.map((row) => [row.source, row.minutes, row.deleted_at !== null]).toSorted(),
    ).toEqual([
      ["manual", 30, true],
      ["timer", null, false],
    ]);
  });
});
