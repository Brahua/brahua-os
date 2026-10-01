// P6: the contracts of `projects` against the throwaway database: the summary for `today` (due
// soon, overdue and blocked; never maintenance due dates, done, canceled or deleted) and a fake
// progress source that reads the database, as `tasks` will.
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { lifeAreas } from "@/modules/core/db/schema";
import { seed } from "@/modules/core/seed";
import {
  contributedProgress,
  getProjectsTodaySummary,
  registerProgressSource,
  selectProjectsTodaySummary,
} from "@/modules/projects/contracts";
import { projectDependencies, projects } from "@/modules/projects/db/schema";
import { AUTH_ENV, OTHER, OWNER, sessionCookieFor } from "./owner-session";
import { testDb } from "./test-db";

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const ORIGINAL_ENV = { ...process.env };
// 10:00 of Oct 1 in Lima (UTC-5).
const NOW = new Date("2026-10-01T15:00:00Z");

async function areaId(slug: string): Promise<string> {
  const [area] = await testDb
    .select({ id: lifeAreas.id })
    .from(lifeAreas)
    .where(eq(lifeAreas.slug, slug));
  return area.id;
}

async function insertRaw(name: string, values: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(projects)
    .values({ name, lifeAreaId: await areaId("home"), ...values })
    .returning();
  return row;
}

async function edge(projectId: string, blockedById: string) {
  await testDb.insert(projectDependencies).values({ projectId, blockedById });
}

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

describe("getProjectsTodaySummary", () => {
  test("due within 7 days, today and overdue, in Idea, Activo and Pausado, overdue first", async () => {
    await insertRaw("Activo en 3", { status: "active", dueDate: "2026-10-04" });
    await insertRaw("Idea hoy", { status: "idea", dueDate: "2026-10-01" });
    await insertRaw("Pausado vencido", { status: "paused", dueDate: "2026-09-20" });
    await insertRaw("Activo en 7", { status: "active", dueDate: "2026-10-08", priority: "high" });
    await insertRaw("Activo en 8", { status: "active", dueDate: "2026-10-09" });
    await insertRaw("Sin fecha", { status: "active" });

    const summary = await getProjectsTodaySummary(NOW);
    expect(summary.map((item) => [item.name, item.due?.label])).toEqual([
      ["Pausado vencido", "Vencido hace 11 días"],
      ["Idea hoy", "Vence hoy"],
      ["Activo en 3", "Vence en 3 días"],
      ["Activo en 7", "Vence en 7 días"],
    ]);
    expect(summary[3]).toEqual({
      id: expect.any(String),
      name: "Activo en 7",
      area: expect.objectContaining({ slug: "home", name: expect.any(String) }),
      status: "active",
      priority: "high",
      dueDate: "2026-10-08",
      due: { kind: "soon", days: 7, label: "Vence en 7 días" },
      blockedBy: [],
    });
  });

  test("leaves out maintenance due dates, done, canceled and deleted projects", async () => {
    // Positive control: one that must show up.
    await insertRaw("Visible", { status: "active", dueDate: "2026-09-30" });
    await insertRaw("Mantenimiento", { status: "maintenance", dueDate: "2026-09-30" });
    await insertRaw("Terminado", {
      status: "done",
      dueDate: "2026-09-30",
      completedAt: new Date("2026-09-29T12:00:00Z"),
    });
    await insertRaw("Cancelado", { status: "canceled", dueDate: "2026-09-30" });
    await insertRaw("Eliminado", { status: "active", dueDate: "2026-09-30", deletedAt: NOW });
    expect((await getProjectsTodaySummary(NOW)).map((item) => item.name)).toEqual(["Visible"]);
  });

  test("blocked projects show with their blockers, whatever their due date", async () => {
    const blocker = await insertRaw("Bloqueador", { status: "active" });
    const second = await insertRaw("Otro bloqueador", { status: "idea" });
    const blocked = await insertRaw("Bloqueado", { status: "active", dueDate: "2027-01-01" });
    const maintenance = await insertRaw("Mantenimiento bloqueado", { status: "maintenance" });
    const late = await insertRaw("Vencido y bloqueado", {
      status: "active",
      dueDate: "2026-09-29",
    });
    await edge(blocked.id, blocker.id);
    await edge(blocked.id, second.id);
    await edge(maintenance.id, blocker.id);
    await edge(late.id, blocker.id);

    const summary = await getProjectsTodaySummary(NOW);
    expect(summary.map((item) => [item.name, item.blockedBy.map((b) => b.name)])).toEqual([
      ["Vencido y bloqueado", ["Bloqueador"]],
      ["Bloqueado", ["Bloqueador", "Otro bloqueador"]],
      ["Mantenimiento bloqueado", ["Bloqueador"]],
    ]);
    expect(summary[1]).toMatchObject({ due: null, dueDate: "2027-01-01" });
    expect(summary[1].blockedBy).toEqual([
      { id: blocker.id, name: "Bloqueador" },
      { id: second.id, name: "Otro bloqueador" },
    ]);
  });

  test("a blocker that is done, canceled or deleted no longer blocks; done or canceled projects are never blocked", async () => {
    const done = await insertRaw("Bloqueador terminado", {
      status: "done",
      completedAt: new Date("2026-09-29T12:00:00Z"),
    });
    const canceled = await insertRaw("Bloqueador cancelado", { status: "canceled" });
    const deleted = await insertRaw("Bloqueador eliminado", { status: "active", deletedAt: NOW });
    const active = await insertRaw("Bloqueador activo", { status: "active" });
    const freed = await insertRaw("Liberado", { status: "active" });
    await edge(freed.id, done.id);
    await edge(freed.id, canceled.id);
    await edge(freed.id, deleted.id);
    const finished = await insertRaw("Terminado con bloqueador", {
      status: "done",
      completedAt: new Date("2026-09-29T12:00:00Z"),
    });
    await edge(finished.id, active.id);
    const deletedBlocked = await insertRaw("Eliminado bloqueado", {
      status: "active",
      deletedAt: NOW,
    });
    await edge(deletedBlocked.id, active.id);
    // Positive control.
    const still = await insertRaw("Sigue bloqueado", { status: "paused" });
    await edge(still.id, active.id);

    expect((await getProjectsTodaySummary(NOW)).map((item) => item.name)).toEqual([
      "Sigue bloqueado",
    ]);
  });

  test("uses Lima's day: at 23:59 of Sep 30 in Lima (Oct 1 in UTC) Oct 8 is not due soon yet", async () => {
    await insertRaw("Oct 1", { status: "active", dueDate: "2026-10-01" });
    await insertRaw("Oct 8", { status: "active", dueDate: "2026-10-08" });
    await insertRaw("Sep 30", { status: "active", dueDate: "2026-09-30" });
    const lateSep30 = new Date("2026-10-01T04:59:00Z");
    expect(
      (await selectProjectsTodaySummary(testDb, lateSep30)).map((item) => item.due?.label),
    ).toEqual(["Vence hoy", "Vence en 1 día"]);
    const earlyOct1 = new Date("2026-10-01T05:00:00Z");
    expect(
      (await selectProjectsTodaySummary(testDb, earlyOct1)).map((item) => item.due?.label),
    ).toEqual(["Vencido hace 1 día", "Vence hoy", "Vence en 7 días"]);
  });

  test("empty when nothing is due or blocked", async () => {
    await insertRaw("Tranquilo", { status: "active", dueDate: "2026-12-01" });
    expect(await getProjectsTodaySummary(NOW)).toEqual([]);
  });

  test("redirects to /login without an owner session", async () => {
    const redirect = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/login;/) };
    request.headers = new Headers();
    await expect(getProjectsTodaySummary(NOW)).rejects.toMatchObject(redirect);
    request.headers = new Headers({ cookie: "better-auth.session_token=forged" });
    await expect(getProjectsTodaySummary(NOW)).rejects.toMatchObject(redirect);
    request.headers = new Headers({ cookie: await sessionCookieFor(OTHER) });
    await expect(getProjectsTodaySummary(NOW)).rejects.toMatchObject(redirect);
  });
});

describe("progress sources", () => {
  let remove: (() => void) | undefined;
  afterEach(() => {
    remove?.();
    remove = undefined;
  });

  test("a fake source that reads the database contributes counts for the ids asked", async () => {
    const a = await insertRaw("A", { status: "active" });
    const b = await insertRaw("B", { status: "done", completedAt: NOW });
    await insertRaw("C", { status: "active" });
    // As `tasks` will: one query for all the ids. Here, "done" projects count 1 of 1, others 0 of 2.
    remove = registerProgressSource({
      id: "fake-tasks",
      async countsFor(projectIds) {
        const rows = await testDb
          .select({ id: projects.id, status: projects.status })
          .from(projects)
          .where(inArray(projects.id, [...projectIds]));
        return new Map(
          rows.map((row) => [
            row.id,
            row.status === "done" ? { done: 1, total: 1 } : { done: 0, total: 2 },
          ]),
        );
      },
    });
    expect(await contributedProgress([a.id, b.id])).toEqual(
      new Map([
        [a.id, { done: 0, total: 2 }],
        [b.id, { done: 1, total: 1 }],
      ]),
    );
  });

  test("with no source registered, nothing is contributed", async () => {
    const a = await insertRaw("A", { status: "active" });
    expect(await contributedProgress([a.id])).toEqual(new Map());
  });
});
