// `db:household:import` against the throwaway database: dry run writes nothing, the rows become
// recurring tasks tagged `limpieza` and with their zone, a second run inserts nothing, what the
// owner changed is never overwritten, a title already pending is skipped, two imports at once leave
// one set, and the imported series survives a completion (the next occurrence keeps the tags).
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ownerDateKey } from "@/lib/time";
import { addCleaning } from "@/modules/household/actions";
import { completeModuleTask, getTasksByTag } from "@/modules/tasks/contracts";
import { taskTagLinks, taskTags, tasks } from "@/modules/tasks/db/schema";
import {
  importCleaningId,
  importFileSchema,
  importHousehold,
  type ImportFile,
} from "../../scripts/household-import";
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

const NOW = new Date();
const TODAY = ownerDateKey(NOW);
const ID = (n: number) => String(n).padStart(32, "0");

function fileOf(...rows: Partial<ImportFile["cleanings"][number]>[]): ImportFile {
  return importFileSchema.parse({
    source: "notion",
    exportedAt: "2026-10-14",
    cleanings: rows.map((patch, index) => ({
      notionId: ID(index + 1),
      title: `Limpieza ${index + 1}`,
      zone: "Baño",
      frequency: "Diario",
      weekday: null,
      nextDate: null,
      completed: false,
      ...patch,
    })),
  });
}

const run = (file: ImportFile, dryRun = false) => importHousehold(testDb, file, NOW, { dryRun });

async function tagsOf(taskId: string) {
  const rows = await testDb
    .select({ name: taskTags.name })
    .from(taskTagLinks)
    .innerJoin(taskTags, eq(taskTags.id, taskTagLinks.tagId))
    .where(eq(taskTagLinks.taskId, taskId));
  return rows.map((row) => row.name).toSorted();
}

describe("a dry run", () => {
  test("reports the plan and writes nothing, not even tags", async () => {
    const report = await run(fileOf({}, { frequency: "Mensual", zone: "Sala/Comedor" }), true);
    expect(report).toMatchObject({ dryRun: true, inserted: 2, skipped: 0, sameTitle: 0 });
    expect(await testDb.select().from(tasks)).toHaveLength(0);
    expect(await testDb.select().from(taskTags)).toHaveLength(0);
  });
});

describe("the import", () => {
  test("creates the tasks in the inbox with their rule, first day, cleaning tag and zone", async () => {
    const report = await run(
      fileOf(
        { title: "Limpiar inodoro", frequency: "Semanal", weekday: "Miercoles", zone: "Baño" },
        {
          title: "Trapear",
          frequency: "Quincenal",
          zone: "Cocina/Lavanderia",
          nextDate: "2999-01-01",
        },
        { title: "Sin zona", zone: null, frequency: "Trimestral" },
      ),
    );
    expect(report).toMatchObject({ inserted: 3, skipped: 0 });
    const rows = await testDb.select().from(tasks).orderBy(tasks.title);
    const byTitle = Object.fromEntries(rows.map((task) => [task.title, task]));
    expect(byTitle["Limpiar inodoro"]).toMatchObject({
      recurrenceKind: "weekdays",
      recurrenceWeekdays: [3],
      lifeAreaId: null,
      projectId: null,
      doneAt: null,
    });
    expect(byTitle["Limpiar inodoro"].dueDate! >= TODAY).toBe(true);
    expect(byTitle["Trapear"]).toMatchObject({
      recurrenceKind: "every_weeks",
      recurrenceInterval: 2,
      dueDate: "2999-01-01",
    });
    expect(byTitle["Sin zona"]).toMatchObject({
      recurrenceKind: "every_months",
      recurrenceInterval: 3,
      dueDate: TODAY,
    });
    expect(await tagsOf(byTitle["Limpiar inodoro"].id)).toEqual(["limpieza", "zona: baño"]);
    expect(await tagsOf(byTitle["Trapear"].id)).toEqual(["limpieza", "zona: cocina/lavandería"]);
    expect(await tagsOf(byTitle["Sin zona"].id)).toEqual(["limpieza"]);
    expect(byTitle["Limpiar inodoro"].id).toBe(importCleaningId(ID(1)));
  });

  test("a second run inserts nothing; a task the owner completed or deleted is not brought back", async () => {
    const file = fileOf({}, {}, {});
    expect((await run(file)).inserted).toBe(3);
    await testDb
      .update(tasks)
      .set({ doneAt: new Date() })
      .where(eq(tasks.id, importCleaningId(ID(1))));
    await testDb
      .update(tasks)
      .set({ deletedAt: new Date() })
      .where(eq(tasks.id, importCleaningId(ID(2))));
    await testDb
      .update(tasks)
      .set({ title: "La renombré" })
      .where(eq(tasks.id, importCleaningId(ID(3))));
    const again = await run(file);
    expect(again).toMatchObject({ inserted: 0, skipped: 3, sameTitle: 0 });
    const rows = await testDb.select().from(tasks);
    expect(rows).toHaveLength(3);
    expect(rows.find((task) => task.id === importCleaningId(ID(3)))?.title).toBe("La renombré");
  });

  test("a title that is already a pending cleaning is skipped, with a warning", async () => {
    const typed = await addCleaning({ title: "limpiar INODORO", zone: "Baño", frequency: "daily" });
    expect(typed.ok).toBe(true);
    const report = await run(fileOf({ title: "Limpiar inodoro" }, { title: "Otra" }));
    expect(report).toMatchObject({ inserted: 1, sameTitle: 1 });
    expect(
      report.warnings.some((warning) => warning.includes("ya hay una limpieza pendiente")),
    ).toBe(true);
    expect(await testDb.select().from(tasks)).toHaveLength(2);
  });

  test("two imports at once leave one set of tasks", async () => {
    const file = fileOf({}, {}, {}, {});
    const reports = await Promise.all([run(file), run(file), run(file)]);
    expect(reports.reduce((sum, report) => sum + report.inserted, 0)).toBe(4);
    expect(await testDb.select().from(tasks)).toHaveLength(4);
    // Each task has its two tags once.
    for (const task of await testDb.select().from(tasks)) {
      expect(await tagsOf(task.id)).toEqual(["limpieza", "zona: baño"]);
    }
  });

  test("the imported series survives a completion: the next occurrence keeps the tags and the view lists it", async () => {
    await run(fileOf({ title: "Limpiar inodoro", frequency: "Diario" }));
    const listed = await getTasksByTag("limpieza");
    expect(listed.map((task) => task.title)).toEqual(["Limpiar inodoro"]);
    const done = await completeModuleTask(listed[0].id);
    expect(done?.next).not.toBeNull();
    const after = await getTasksByTag("limpieza");
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(listed[0].id);
    expect(after[0].tags.toSorted()).toEqual(["limpieza", "zona: baño"]);
    // The original is done, the next one is pending and visible.
    const pending = await testDb
      .select()
      .from(tasks)
      .where(and(isNull(tasks.doneAt), isNull(tasks.deletedAt)));
    expect(pending).toHaveLength(1);
  });

  test("an empty file imports nothing and doesn't fail", async () => {
    expect(await run(fileOf())).toMatchObject({ inserted: 0, skipped: 0 });
  });
});
