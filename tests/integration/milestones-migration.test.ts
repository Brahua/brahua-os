// hitos-agrupan-tareas H2: the data move of migration 0023 against the throwaway database. The file's
// statements run on rows made while the CHECK is off (as production's old rows are), then the CHECK
// is added: that proves the move leaves data the constraint accepts. Idempotent: twice is the same.
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import { projectMilestones, projects } from "@/modules/projects/db/schema";
import { tasks } from "@/modules/tasks/db/schema";
import { testDb } from "./test-db";

const FILE = path.join(process.cwd(), "drizzle/0023_milestones_group_tasks.sql");
const STATEMENTS = readFileSync(FILE, "utf8")
  .split("--> statement-breakpoint")
  .map((part) => part.trim())
  .filter(Boolean);
const CONSTRAINT = "tasks_milestone_not_recurring_check";

beforeEach(async () => {
  await seed(testDb);
  // Old rows exist while the CHECK is not there yet.
  await testDb.execute(sql.raw(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`));
  // The column was dropped later (0024); the old rows this file moves still have it.
  await testDb.execute(
    sql.raw("ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS done_at timestamptz"),
  );
});

afterEach(async () => {
  await testDb.execute(sql.raw("ALTER TABLE project_milestones DROP COLUMN IF EXISTS done_at"));
  // Leave the constraint where the schema has it for the other files (idempotent).
  await testDb.execute(sql.raw(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`));
  await testDb.execute(
    sql.raw(
      `ALTER TABLE tasks ADD CONSTRAINT ${CONSTRAINT} CHECK (milestone_id IS NULL OR recurrence_kind IS NULL)`,
    ),
  );
});

async function run(index: number) {
  await testDb.execute(sql.raw(STATEMENTS[index]));
}

async function project() {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, "home"));
  const [row] = await testDb
    .insert(projects)
    .values({ name: "Cocina", lifeAreaId: area.id, status: "active" })
    .returning();
  return row.id;
}

async function milestone(
  projectId: string,
  title: string,
  values: Partial<typeof projectMilestones.$inferInsert> & { doneAt?: Date } = {},
) {
  const { doneAt, ...rest } = values;
  const [row] = await testDb
    .insert(projectMilestones)
    .values({ projectId, title, sortOrder: 0, ...rest })
    .returning();
  if (doneAt) {
    await testDb.execute(
      sql`update project_milestones set done_at = ${doneAt.toISOString()} where id = ${row.id}`,
    );
  }
  return row;
}

describe("migration 0023", () => {
  test("the file has the three statements in order: recurring out, milestones into tasks, the CHECK", () => {
    expect(STATEMENTS).toHaveLength(3);
    expect(STATEMENTS[0]).toMatch(/^(--[^\n]*\n)*UPDATE "tasks"/);
    expect(STATEMENTS[1]).toMatch(/INSERT INTO "tasks"/);
    expect(STATEMENTS[2]).toMatch(/ADD CONSTRAINT "tasks_milestone_not_recurring_check"/);
  });

  test("recurring tasks leave their milestone (and only the milestone link goes)", async () => {
    const id = await project();
    const planos = await milestone(id, "Planos");
    const [repeats] = await testDb
      .insert(tasks)
      .values({
        title: "repite",
        projectId: id,
        milestoneId: planos.id,
        recurrenceKind: "every_days",
        recurrenceInterval: 1,
      })
      .returning();
    const [plain] = await testDb
      .insert(tasks)
      .values({ title: "normal", projectId: id, milestoneId: planos.id })
      .returning();
    await run(0);
    const [after] = await testDb.select().from(tasks).where(eq(tasks.id, repeats.id));
    expect(after).toMatchObject({ milestoneId: null, projectId: id, recurrenceKind: "every_days" });
    const [kept] = await testDb.select().from(tasks).where(eq(tasks.id, plain.id));
    expect(kept.milestoneId).toBe(planos.id);
  });

  test("a milestone with no tasks becomes one task (done if it was, pending if not), with its date", async () => {
    const id = await project();
    const doneAt = new Date("2026-10-01T15:00:00Z");
    const done = await milestone(id, "Cirugía", { doneAt, sortOrder: 0 });
    const pending = await milestone(id, "Fisioterapia", { dueDate: "2026-12-01", sortOrder: 1 });
    await run(1);
    const created = await testDb.select().from(tasks).where(eq(tasks.projectId, id));
    expect(created).toHaveLength(2);
    const ofDone = created.find((task) => task.milestoneId === done.id)!;
    expect(ofDone).toMatchObject({
      title: "Cirugía",
      projectId: id,
      doneAt,
      dueDate: null,
      priority: "medium",
    });
    const ofPending = created.find((task) => task.milestoneId === pending.id)!;
    expect(ofPending).toMatchObject({ title: "Fisioterapia", doneAt: null, dueDate: "2026-12-01" });
  });

  test("a milestone that has tasks keeps them (its old done_at is ignored); deleted ones and deleted tasks do not count", async () => {
    const id = await project();
    const withTask = await milestone(id, "Con tarea", { doneAt: new Date(), sortOrder: 0 });
    const onlyDeletedTask = await milestone(id, "Solo tarea borrada", { sortOrder: 1 });
    const gone = await milestone(id, "Borrado", { deletedAt: new Date(), sortOrder: 2 });
    await testDb.insert(tasks).values({ title: "mía", projectId: id, milestoneId: withTask.id });
    await testDb.insert(tasks).values({
      title: "borrada",
      projectId: id,
      milestoneId: onlyDeletedTask.id,
      deletedAt: new Date(),
    });
    await run(1);
    const all = await testDb.select().from(tasks).where(eq(tasks.projectId, id));
    // withTask: untouched (1 task). onlyDeletedTask: its only task is deleted, so it gets one. gone: none.
    expect(all.filter((task) => task.milestoneId === withTask.id)).toHaveLength(1);
    expect(
      all.filter((task) => task.milestoneId === onlyDeletedTask.id && task.deletedAt === null),
    ).toHaveLength(1);
    expect(all.filter((task) => task.milestoneId === gone.id)).toHaveLength(0);
  });

  test("running it twice changes nothing more (deterministic ids), and the CHECK then goes in", async () => {
    const id = await project();
    const planos = await milestone(id, "Planos", { doneAt: new Date() });
    await testDb.insert(tasks).values({
      title: "repite",
      projectId: id,
      milestoneId: planos.id,
      recurrenceKind: "every_days",
      recurrenceInterval: 1,
    });
    await run(0);
    await run(1);
    const first = await testDb.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, id));
    await run(0);
    await run(1);
    const second = await testDb.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, id));
    expect(second.map((row) => row.id).sort()).toEqual(first.map((row) => row.id).sort());
    expect(first).toHaveLength(2); // the repeating one (now out of the milestone) + the milestone's task
    // Positive control: with the data moved, the constraint is accepted...
    await expect(run(2)).resolves.toBeUndefined();
    // ...and refuses a repeating task in a milestone from then on.
    await expect(
      testDb.insert(tasks).values({
        title: "otra",
        projectId: id,
        milestoneId: planos.id,
        recurrenceKind: "every_days",
        recurrenceInterval: 1,
      }),
    ).rejects.toThrow();
  });
});
