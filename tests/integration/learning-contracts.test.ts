// L3 of `learning` against the throwaway database: what it offers other modules. The progress
// source of `projects` (a track is one unit with its share of steps: at 50 %, finished, without a
// syllabus, a practice, deleted tracks and steps, another project's), added to the tasks through
// the real composition root (1 of 2 tasks + a track at 50 % = 50 %); Hoy's summary (tracks in
// progress, the week's minutes, the running timer); the weekly review's minutes (the Lima week the
// session started in, ended and live only, a deleted track's left out); and authorization.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ensureProgressSources } from "@/lib/progress-sources";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { getLearningTodaySummary, getLearningWeekReview } from "@/modules/learning/contracts";
import { learningSessions, learningSteps, learningTracks } from "@/modules/learning/db/schema";
import { addDays, limaDayStart, mondayOf } from "@/modules/learning/pace";
import { selectLearningProjectCounts } from "@/modules/learning/progress-source";
import { listSteps } from "@/modules/learning/queries";
import { logSession, startSession } from "@/modules/learning/sessions-actions";
import { markStepDone } from "@/modules/learning/steps-actions";
import { changeStatus, createTrack, deleteTrack } from "@/modules/learning/tracks-actions";
import { contributedProgress, selectProjectsProgress } from "@/modules/projects/contracts";
import { projects } from "@/modules/projects/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
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
  await seed(testDb);
  request.headers = new Headers({ cookie: await sessionCookieFor(OWNER) });
});

function data<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`action failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function newProject(name = "Ruta AWS + IA"): Promise<string> {
  const [area] = await testDb.select({ id: lifeAreas.id }).from(lifeAreas).limit(1);
  const [project] = await testDb
    .insert(projects)
    .values({ name, lifeAreaId: area.id, status: "active" })
    .returning({ id: projects.id });
  return project.id;
}

/** A track (waiting unless told otherwise) with a syllabus of `steps` lines; its id. */
async function track(
  values: { title?: string; kind?: string; status?: string; projectId?: string } = {},
  steps = 0,
): Promise<string> {
  const syllabus = Array.from({ length: steps }, (_, index) => `Clase ${index + 1}`).join("\n");
  const created = data(
    await createTrack({
      title: values.title ?? "AWS SAA",
      kind: values.kind ?? "course",
      status: values.status ?? "waiting",
      projectId: values.projectId,
      ...(steps > 0 ? { syllabus } : {}),
    }),
  );
  return created.track.id;
}

/** Checks the first `count` steps of a track. */
async function check(trackId: string, count: number) {
  const steps = await listSteps(trackId);
  for (const step of steps.slice(0, count)) {
    data(await markStepDone({ trackId, id: step.id, done: true }));
  }
}

const counts = async (projectId: string) =>
  (await selectLearningProjectCounts(testDb, [projectId])).get(projectId);

describe("the progress source of projects", () => {
  test("a track at 50 % is half a unit; finished is one; no syllabus or a practice is zero", async () => {
    const project = await newProject();
    const half = await track({ projectId: project }, 4);
    await check(half, 2);
    expect(await counts(project)).toEqual({ done: 0.5, total: 1 });

    // Without a syllabus: one unit, nothing done until it is finished.
    const bare = await track({ title: "Libro", kind: "book", projectId: project });
    // A practice: the same.
    await track({ title: "Inglés", kind: "practice", projectId: project });
    expect(await counts(project)).toEqual({ done: 0.5, total: 3 });

    // Finished (even with nothing checked): a whole unit.
    data(await changeStatus({ id: bare, to: "done" }));
    expect(await counts(project)).toEqual({ done: 1.5, total: 3 });
  });

  test("deleted tracks and deleted steps never count; another project's tracks neither", async () => {
    const project = await newProject();
    const other = await newProject("Otro");
    const kept = await track({ projectId: project }, 2);
    await check(kept, 1);
    const gone = await track({ title: "Docker", projectId: project }, 2);
    await track({ title: "Ajeno", projectId: other }, 2);
    // Positive control: both count before the delete.
    expect(await counts(project)).toEqual({ done: 0.5, total: 2 });
    data(await deleteTrack({ id: gone }));
    expect(await counts(project)).toEqual({ done: 0.5, total: 1 });

    // A deleted step leaves the share: 1 of 1 live step.
    const [, second] = await listSteps(kept);
    await testDb
      .update(learningSteps)
      .set({ deletedAt: new Date() })
      .where(eq(learningSteps.id, second.id));
    expect(await counts(project)).toEqual({ done: 1, total: 1 });
    // A track without a project, and no ids, count nowhere.
    await track({ title: "Suelto" }, 2);
    expect(await selectLearningProjectCounts(testDb, [])).toEqual(new Map());
    expect((await selectLearningProjectCounts(testDb, [other])).get(other)).toEqual({
      done: 0,
      total: 1,
    });
  });

  test("through the composition root: 1 of 2 tasks plus a track at 50 % is 1.5 of 3, 50 %", async () => {
    ensureProgressSources();
    const project = await newProject();
    await testDb.insert(tasks).values([
      { title: "Tarea hecha", projectId: project, doneAt: new Date() },
      { title: "Tarea abierta", projectId: project },
    ]);
    const half = await track({ projectId: project }, 2);
    await check(half, 1);
    expect((await contributedProgress([project])).get(project)).toEqual({ done: 1.5, total: 3 });
    expect((await selectProjectsProgress(testDb, [project])).get(project)).toMatchObject({
      percent: 50,
    });
  });
});

describe("Hoy's summary", () => {
  test("the tracks in progress with their next steps, this week's minutes and the timer", async () => {
    const aws = await track({ title: "AWS SAA", status: "active" }, 3);
    await check(aws, 1);
    await track({ title: "En espera", status: "waiting" }, 2);
    const today = ownerDateKey(new Date());
    data(await logSession({ trackId: aws, minutes: 45, day: today }));
    // Last week's session doesn't count in this week's.
    data(await logSession({ trackId: aws, minutes: 30, day: addDays(mondayOf(today), -1) }));
    const { session } = data(await startSession({ trackId: aws }));

    const summary = await getLearningTodaySummary(new Date());
    expect(summary.tracks).toHaveLength(1);
    expect(summary.tracks[0]).toMatchObject({
      id: aws,
      title: "AWS SAA",
      kind: "course",
      steps: { done: 1, total: 3 },
      upcoming: [{ title: "Clase 2" }, { title: "Clase 3" }],
      weekMinutes: 45,
      weeklyTargetMinutes: null,
    });
    expect(summary.running).toMatchObject({ id: session.id, trackId: aws });
  });

  test("nothing in progress: no tracks", async () => {
    await track({ status: "waiting" }, 2);
    expect(await getLearningTodaySummary(new Date())).toEqual({ tracks: [], running: null });
  });
});

describe("the weekly review's minutes", () => {
  test("ended, live sessions that started in that Lima week; a deleted track's are left out", async () => {
    const aws = await track({ title: "AWS SAA" }, 0);
    const docker = await track({ title: "Docker" }, 0);
    const monday = "2026-10-12";
    const at = (iso: string, minutes: number, trackId = aws) => ({
      trackId,
      source: "manual" as const,
      startedAt: new Date(iso),
      endedAt: new Date(new Date(iso).getTime() + minutes * 60_000),
      minutes,
    });
    await testDb.insert(learningSessions).values([
      // Monday 00:00 Lima (05:00 UTC): in.
      at("2026-10-12T05:00:00Z", 30),
      // Sunday 23:59 Lima, ending on Monday: in (the week it started).
      at("2026-10-19T04:59:00Z", 20),
      // Sunday 23:59 Lima of the week before: out.
      at("2026-10-12T04:59:00Z", 100),
      // Next Monday 00:00 Lima: out.
      at("2026-10-19T05:00:00Z", 100),
      // A removed session: out.
      { ...at("2026-10-14T15:00:00Z", 100), deletedAt: new Date() },
      // A deleted track's session: out (after the delete below).
      at("2026-10-15T15:00:00Z", 40, docker),
    ]);
    // A running timer that started that week: not ended, not counted.
    await testDb
      .insert(learningSessions)
      .values({ trackId: aws, source: "timer", startedAt: new Date("2026-10-16T15:00:00Z") });
    // Positive control: with the track live, its session counts.
    expect(await getLearningWeekReview(monday)).toEqual({ minutes: 90 });
    data(await deleteTrack({ id: docker }));
    expect(await getLearningWeekReview(monday)).toEqual({ minutes: 50 });
    // Any day of the week reads its week; another week reads its own.
    expect(await getLearningWeekReview("2026-10-15")).toEqual({ minutes: 50 });
    expect(await getLearningWeekReview("2026-10-05")).toEqual({ minutes: 100 });
    expect(limaDayStart(monday).toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  test("a malformed week reads nothing", async () => {
    expect(await getLearningWeekReview("2026-13-45")).toEqual({ minutes: 0 });
    expect(await getLearningWeekReview("ayer")).toEqual({ minutes: 0 });
  });
});

describe("authorization", () => {
  test.each([
    ["no session", async () => new Headers()],
    ["another user", async () => new Headers({ cookie: await sessionCookieFor(OTHER) })],
  ])("with %s the reads redirect to /login", async (_, headers) => {
    await track({ status: "active" }, 2);
    // Positive control: the owner reads.
    expect((await getLearningTodaySummary(new Date())).tracks).toHaveLength(1);
    request.headers = await headers();
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    await expect(getLearningTodaySummary(new Date())).rejects.toMatchObject(redirect);
    await expect(getLearningWeekReview("2026-10-12")).rejects.toMatchObject(redirect);
    expect(await testDb.select().from(learningTracks)).toHaveLength(1);
  });
});
