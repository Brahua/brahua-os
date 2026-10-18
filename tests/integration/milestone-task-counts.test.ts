// hitos-agrupan-tareas H1 against the throwaway database: `countMilestoneTasks` (done, total and the
// last done instant of each milestone's visible tasks) and the registered source's answer through
// the projects contract.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ensureProgressSources } from "@/lib/progress-sources";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { contributedMilestones } from "@/modules/projects/contracts";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
import { milestoneState } from "@/modules/tasks/milestone-state";
import { countMilestoneTasks } from "@/modules/tasks/project-tasks";
import { testDb } from "./test-db";

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

async function newProject(name = "Cocina") {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, "home"));
  const [project] = await testDb
    .insert(projects)
    .values({ name, lifeAreaId: area.id, status: "active" })
    .returning();
  return project;
}

async function newMilestone(projectId: string, title: string, sortOrder = 0) {
  const [milestone] = await testDb
    .insert(projectMilestones)
    .values({ projectId, title, sortOrder })
    .returning();
  return milestone;
}

const task = (values: Partial<typeof tasks.$inferInsert> & { title: string }) =>
  testDb
    .insert(tasks)
    .values(values)
    .returning()
    .then(([row]) => row);

beforeEach(async () => {
  await seed(testDb);
});

describe("countMilestoneTasks", () => {
  test("done, total and the last done instant by milestone; one without tasks is missing", async () => {
    const project = await newProject();
    const plans = await newMilestone(project.id, "Planos", 0);
    const paint = await newMilestone(project.id, "Pintura", 1);
    const empty = await newMilestone(project.id, "Entrega", 2);
    const first = new Date("2026-10-03T15:00:00Z");
    const last = new Date("2026-10-06T15:00:00Z");
    await task({ title: "medir", projectId: project.id, milestoneId: plans.id, doneAt: first });
    await task({ title: "dibujar", projectId: project.id, milestoneId: plans.id, doneAt: last });
    await task({ title: "lijar", projectId: project.id, milestoneId: paint.id });
    await task({ title: "pintar", projectId: project.id, milestoneId: paint.id, doneAt: first });

    const counts = await countMilestoneTasks(testDb, [plans.id, paint.id, empty.id]);
    expect(counts.get(plans.id)).toEqual({ done: 2, total: 2, lastDoneAt: last });
    expect(counts.get(paint.id)).toEqual({ done: 1, total: 2, lastDoneAt: first });
    expect(counts.has(empty.id)).toBe(false);
    expect(milestoneState(counts.get(plans.id)).status).toBe("complete");
    expect(milestoneState(counts.get(paint.id)).status).toBe("inProgress");
    expect(milestoneState(counts.get(empty.id)).status).toBe("empty");
  });

  test("a deleted task, the tasks of a deleted project and tasks of other milestones never count", async () => {
    const project = await newProject();
    const other = await newProject("Otro");
    const plans = await newMilestone(project.id, "Planos");
    const elsewhere = await newMilestone(other.id, "Otro hito");
    await task({ title: "vivo", projectId: project.id, milestoneId: plans.id, doneAt: new Date() });
    await task({
      title: "borrado",
      projectId: project.id,
      milestoneId: plans.id,
      deletedAt: new Date(),
    });
    await task({ title: "ajeno", projectId: other.id, milestoneId: elsewhere.id });
    expect((await countMilestoneTasks(testDb, [plans.id])).get(plans.id)).toMatchObject({
      done: 1,
      total: 1,
    });
    // Delete the project: its tasks hide with it (positive control above: they counted before).
    await testDb.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, project.id));
    expect((await countMilestoneTasks(testDb, [plans.id, elsewhere.id])).has(plans.id)).toBe(false);
    expect((await countMilestoneTasks(testDb, [elsewhere.id])).get(elsewhere.id)).toMatchObject({
      total: 1,
    });
    expect(await countMilestoneTasks(testDb, [])).toEqual(new Map());
  });

  test("the registered source answers through the projects contract", async () => {
    ensureProgressSources();
    const project = await newProject();
    const plans = await newMilestone(project.id, "Planos");
    const at = new Date("2026-10-04T12:00:00Z");
    await task({ title: "uno", projectId: project.id, milestoneId: plans.id, doneAt: at });
    const answer = await contributedMilestones([plans.id]);
    expect(answer.get(plans.id)).toEqual({ done: 1, total: 1, lastDoneAt: at });
  });
});
