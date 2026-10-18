// hitos-agrupan-tareas H2 against the throwaway database: a milestone has no checkbox, its state is
// derived from its tasks (read through the projects contract), completing the last open task says
// «Hito completo» (and undoing it reopens the phase), and a task that repeats can't be in a milestone.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { selectMilestoneViews, selectPhaseCounts } from "@/modules/projects/milestone-views";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import { createTask, deleteTask, editTask, restoreTask } from "@/modules/tasks/actions";
import { setTaskMilestone } from "@/modules/tasks/detail-actions";
import { tasks } from "@/modules/tasks/db/schema";
import {
  completeTaskWithNext,
  reopenTaskWithSpawn,
  setTaskRecurrence,
} from "@/modules/tasks/recurrence-actions";
import { TASK_ERRORS } from "@/modules/tasks/task-input";
import { AUTH_ENV, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };
const DAILY = { kind: "every_days", interval: 1 } as const;

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

async function newProject() {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, "home"));
  const [project] = await testDb
    .insert(projects)
    .values({ name: "Cocina", lifeAreaId: area.id, status: "active" })
    .returning();
  return project.id;
}

async function newMilestone(projectId: string, title: string, sortOrder = 0) {
  const [row] = await testDb
    .insert(projectMilestones)
    .values({ projectId, title, sortOrder })
    .returning();
  return row.id;
}

async function addTask(projectId: string, milestoneId: string | null, title: string) {
  const result = await createTask({ title, projectId, milestoneId });
  if (!result.ok) throw new Error(`createTask failed: ${JSON.stringify(result)}`);
  return result.data.id;
}

const view = async (projectId: string) =>
  Object.fromEntries(
    (await selectMilestoneViews(testDb, projectId)).map((item) => [
      item.title,
      { done: item.tasks.done, total: item.tasks.total, complete: item.doneAt !== null },
    ]),
  );

describe("the state of a milestone is derived from its tasks", () => {
  test("empty, in progress and complete; a deleted task and a restored one change it", async () => {
    const project = await newProject();
    const planos = await newMilestone(project, "Planos", 0);
    const pintura = await newMilestone(project, "Pintura", 1);
    await newMilestone(project, "Entrega", 2);
    const a = await addTask(project, planos, "medir");
    const b = await addTask(project, planos, "dibujar");
    await addTask(project, pintura, "lijar");
    await completeTaskWithNext({ id: a });
    await completeTaskWithNext({ id: b });

    expect(await view(project)).toEqual({
      Planos: { done: 2, total: 2, complete: true },
      Pintura: { done: 0, total: 1, complete: false },
      Entrega: { done: 0, total: 0, complete: false }, // no tasks: never complete
    });
    expect(await selectPhaseCounts(testDb, project)).toEqual({ done: 1, total: 3 });

    // A deleted task leaves the count; the phase of one task left is complete when it is done.
    await deleteTask({ id: b });
    expect((await view(project)).Planos).toEqual({ done: 1, total: 1, complete: true });
    // Restoring it brings the count back, still complete.
    await restoreTask({ id: b });
    expect((await view(project)).Planos).toEqual({ done: 2, total: 2, complete: true });
    // Reopening one task reopens the phase.
    await reopenTaskWithSpawn({ id: a });
    expect((await view(project)).Planos).toEqual({ done: 1, total: 2, complete: false });
  });

  test("nothing is written on the milestone: done_at stays null", async () => {
    const project = await newProject();
    const milestone = await newMilestone(project, "Planos");
    const id = await addTask(project, milestone, "medir");
    await completeTaskWithNext({ id });
    const [row] = await testDb
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, milestone));
    expect(row.doneAt).toBeNull();
  });
});

describe("«Hito completo»: completing the last open task of a phase", () => {
  test("the completion reports the phase it closed, once; the others report none", async () => {
    const project = await newProject();
    const planos = await newMilestone(project, "Planos");
    const first = await addTask(project, planos, "medir");
    const last = await addTask(project, planos, "dibujar");
    const loose = await addTask(project, null, "suelta");

    const notLast = await completeTaskWithNext({ id: first });
    expect(notLast.ok && notLast.data.phase).toBeNull();
    const closes = await completeTaskWithNext({ id: last });
    expect(closes.ok && closes.data.phase).toEqual({ id: planos, title: "Planos" });
    // A double tap is not a new closing.
    const again = await completeTaskWithNext({ id: last });
    expect(again.ok && again.data.phase).toBeNull();
    // A task with no milestone closes nothing.
    const none = await completeTaskWithNext({ id: loose });
    expect(none.ok && none.data.phase).toBeNull();
  });

  test("undoing the last one reopens the phase, and completing it again closes it again", async () => {
    const project = await newProject();
    const planos = await newMilestone(project, "Planos");
    const only = await addTask(project, planos, "medir");
    expect((await completeTaskWithNext({ id: only })).ok).toBe(true);
    expect((await view(project)).Planos.complete).toBe(true);
    await reopenTaskWithSpawn({ id: only });
    expect((await view(project)).Planos.complete).toBe(false);
    const closes = await completeTaskWithNext({ id: only });
    expect(closes.ok && closes.data.phase?.title).toBe("Planos");
  });
});

describe("a task that repeats can't be in a milestone", () => {
  test("creating one with both is refused; each alone, and a plain one in a milestone, are fine", async () => {
    const project = await newProject();
    const milestone = await newMilestone(project, "Planos");
    const both = await createTask({
      title: "x",
      projectId: project,
      milestoneId: milestone,
      recurrence: DAILY,
    });
    expect(both).toMatchObject({
      ok: false,
      fieldErrors: { milestoneId: [TASK_ERRORS.milestoneRecurring] },
    });
    expect(
      (await createTask({ title: "solo repite", projectId: project, recurrence: DAILY })).ok,
    ).toBe(true);
    expect(
      (await createTask({ title: "solo hito", projectId: project, milestoneId: milestone })).ok,
    ).toBe(true);
  });

  test("putting a repeating task in a milestone (the detail's picker, or an edit) is refused", async () => {
    const project = await newProject();
    const milestone = await newMilestone(project, "Planos");
    const created = await createTask({ title: "repite", projectId: project, recurrence: DAILY });
    if (!created.ok) throw new Error("setup");
    const id = created.data.id;
    expect(await setTaskMilestone({ id, milestoneId: milestone })).toMatchObject({
      ok: false,
      fieldErrors: { milestoneId: [TASK_ERRORS.milestoneRecurring] },
    });
    expect(
      await editTask({
        id,
        placement: { lifeAreaId: null, projectId: project, milestoneId: milestone },
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { "placement.milestoneId": [TASK_ERRORS.milestoneRecurring] },
    });
    const [row] = await testDb.select().from(tasks).where(eq(tasks.id, id));
    expect(row.milestoneId).toBeNull();
    // Positive control: once it doesn't repeat, it goes in.
    expect((await setTaskRecurrence({ id, recurrence: null })).ok).toBe(true);
    expect((await setTaskMilestone({ id, milestoneId: milestone })).ok).toBe(true);
  });

  test("a rule can't be set on a task that is in a milestone, but can be removed", async () => {
    const project = await newProject();
    const milestone = await newMilestone(project, "Planos");
    const id = await addTask(project, milestone, "medir");
    expect(await setTaskRecurrence({ id, recurrence: DAILY })).toMatchObject({
      ok: false,
      fieldErrors: { recurrence: [TASK_ERRORS.milestoneRecurring] },
    });
    expect((await setTaskRecurrence({ id, recurrence: null })).ok).toBe(true);
    // Out of the milestone, the rule is allowed (positive control).
    expect((await setTask(id)).ok).toBe(true);
  });
});

async function setTask(id: string) {
  await setTaskMilestone({ id, milestoneId: null });
  return setTaskRecurrence({ id, recurrence: DAILY });
}
