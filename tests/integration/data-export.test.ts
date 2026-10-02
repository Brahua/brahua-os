import { chmod, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getTableName, sql } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildExport,
  EXCLUDED_TABLES,
  EXPORT_FORMAT,
  EXPORT_SCHEMA_VERSION,
  EXPORTABLE_TABLES,
  type DataExport,
} from "@/lib/data-export";
import {
  authAccounts,
  authPasskeys,
  authRateLimits,
  authSessions,
  authUsers,
  authVerifications,
  lifeAreas,
} from "@/modules/core/db/schema";
import {
  projectDependencies,
  projectLinks,
  projectMilestones,
  projects,
} from "@/modules/projects/db/schema";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import { taskTagLinks, taskTags, tasks } from "@/modules/tasks/db/schema";
import { writeExport } from "../../scripts/db-export";
import { testDb } from "./test-db";

const NOW = new Date("2026-10-01T13:05:22.000Z");
const ARCHIVED_AT = new Date("2026-09-15T10:00:00.000Z");

// Distinctive values: none of them may appear anywhere in the export.
const SECRETS = {
  email: "owner-export@example.com",
  sessionToken: "session-token-must-not-leak",
  passwordHash: "scrypt-hash-must-not-leak",
  passkeyKey: "public-key-must-not-leak",
  verification: "verification-must-not-leak",
  rateKey: "rate-key-must-not-leak",
};

async function insertAuthData() {
  await testDb.insert(authUsers).values({ id: "u1", name: "Owner", email: SECRETS.email });
  await testDb.insert(authSessions).values({
    id: "s1",
    token: SECRETS.sessionToken,
    userId: "u1",
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  });
  await testDb.insert(authAccounts).values({
    id: "a1",
    accountId: "u1",
    providerId: "credential",
    userId: "u1",
    password: SECRETS.passwordHash,
  });
  await testDb.insert(authPasskeys).values({
    id: "p1",
    publicKey: SECRETS.passkeyKey,
    userId: "u1",
    credentialID: "cred-1",
    counter: 0,
    deviceType: "multiDevice",
    backedUp: true,
  });
  await testDb.insert(authVerifications).values({
    id: "v1",
    identifier: "x",
    value: SECRETS.verification,
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  });
  await testDb
    .insert(authRateLimits)
    .values({ id: "r1", key: SECRETS.rateKey, count: 1, lastRequest: Date.now() });
}

describe("pnpm db:export", () => {
  test("exports every life area, archived ones included, with SQL column names", async () => {
    await testDb.insert(lifeAreas).values([
      { slug: "work", name: "Trabajo", icon: "briefcase", color: "work", sortOrder: 1 },
      {
        slug: "home",
        name: "Hogar",
        icon: "house",
        color: "home",
        sortOrder: 0,
        archivedAt: ARCHIVED_AT,
      },
    ]);

    const data = await buildExport(testDb, NOW);

    expect(data).toMatchObject({
      format: EXPORT_FORMAT,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: "2026-10-01T13:05:22.000Z",
      excludedTables: [...EXCLUDED_TABLES],
    });
    expect(data.note).toMatch(/No incluye tablas de autenticación/);
    const areas = data.tables.core_life_areas;
    expect(areas.rowCount).toBe(2);
    // Ordered by sort_order; archived rows are not filtered out.
    expect(areas.rows.map((row) => row.slug)).toEqual(["home", "work"]);
    expect(Object.keys(areas.rows[0]).sort()).toEqual(
      [
        "archived_at",
        "color",
        "created_at",
        "icon",
        "id",
        "name",
        "slug",
        "sort_order",
        "updated_at",
      ].sort(),
    );
    const parsed = JSON.parse(JSON.stringify(data)) as DataExport;
    expect(parsed.tables.core_life_areas.rows[0]).toMatchObject({
      slug: "home",
      sort_order: 0,
      archived_at: "2026-09-15T10:00:00.000Z",
    });
    expect(parsed.tables.core_life_areas.rows[1].archived_at).toBeNull();
  });

  test("an empty database exports empty tables", async () => {
    const data = await buildExport(testDb, NOW);
    expect(data.tables.core_life_areas).toEqual({ rowCount: 0, rows: [] });
    for (const name of [
      "projects",
      "project_milestones",
      "project_links",
      "project_dependencies",
      "tasks",
      "task_tags",
      "task_tag_links",
      "habits",
      "habit_logs",
      "habit_pauses",
    ]) {
      expect(data.tables[name]).toEqual({ rowCount: 0, rows: [] });
    }
  });

  test("exports the projects with their milestones, links and dependencies, deleted ones included", async () => {
    const [area] = await testDb
      .insert(lifeAreas)
      .values({ slug: "home", name: "Hogar", icon: "house", color: "home" })
      .returning();
    const [kept, deleted] = await testDb
      .insert(projects)
      .values([
        { name: "Mudanza", lifeAreaId: area.id, createdAt: new Date("2026-09-01T00:00:00Z") },
        {
          name: "Borrado",
          lifeAreaId: area.id,
          deletedAt: ARCHIVED_AT,
          createdAt: new Date("2026-09-02T00:00:00Z"),
        },
      ])
      .returning();
    await testDb
      .insert(projectMilestones)
      .values({ projectId: kept.id, title: "Cajas", sortOrder: 0 });
    await testDb
      .insert(projectLinks)
      .values({ projectId: kept.id, url: "https://example.com", sortOrder: 0 });
    await testDb
      .insert(projectDependencies)
      .values({ projectId: kept.id, blockedById: deleted.id });

    const data = JSON.parse(JSON.stringify(await buildExport(testDb, NOW))) as DataExport;

    expect(data.tables.projects.rows.map((row) => [row.name, row.deleted_at])).toEqual([
      ["Mudanza", null],
      ["Borrado", "2026-09-15T10:00:00.000Z"],
    ]);
    expect(data.tables.projects.rows[0]).toMatchObject({
      life_area_id: area.id,
      status: "idea",
      priority: "medium",
      due_date: null,
    });
    expect(data.tables.project_milestones.rows).toEqual([
      expect.objectContaining({ project_id: kept.id, title: "Cajas", sort_order: 0 }),
    ]);
    expect(data.tables.project_links.rows).toEqual([
      expect.objectContaining({ project_id: kept.id, url: "https://example.com" }),
    ]);
    expect(data.tables.project_dependencies.rows).toEqual([
      { project_id: kept.id, blocked_by_id: deleted.id },
    ]);
  });

  test("exports the tasks with their tags, done and deleted ones included (T1)", async () => {
    const [area] = await testDb
      .insert(lifeAreas)
      .values({ slug: "home", name: "Hogar", icon: "house", color: "home" })
      .returning();
    const [inbox, done, removed] = await testDb
      .insert(tasks)
      .values([
        { title: "comprar pilas", createdAt: new Date("2026-09-01T00:00:00Z") },
        {
          title: "regar",
          lifeAreaId: area.id,
          doneAt: ARCHIVED_AT,
          recurrenceKind: "every_days",
          recurrenceInterval: 3,
          createdAt: new Date("2026-09-02T00:00:00Z"),
        },
        { title: "borrada", deletedAt: ARCHIVED_AT, createdAt: new Date("2026-09-03T00:00:00Z") },
      ])
      .returning();
    const [tag] = await testDb.insert(taskTags).values({ name: "compras" }).returning();
    await testDb.insert(taskTagLinks).values({ taskId: inbox.id, tagId: tag.id });

    const data = JSON.parse(JSON.stringify(await buildExport(testDb, NOW))) as DataExport;

    expect(data.tables.tasks.rows.map((row) => [row.title, row.done_at, row.deleted_at])).toEqual([
      ["comprar pilas", null, null],
      ["regar", "2026-09-15T10:00:00.000Z", null],
      ["borrada", null, "2026-09-15T10:00:00.000Z"],
    ]);
    expect(data.tables.tasks.rows[1]).toMatchObject({
      id: done.id,
      life_area_id: area.id,
      project_id: null,
      priority: "medium",
      recurrence_kind: "every_days",
      recurrence_interval: 3,
      recurrence_weekdays: null,
    });
    expect(removed.deletedAt).not.toBeNull();
    expect(data.tables.task_tags.rows).toEqual([expect.objectContaining({ name: "compras" })]);
    expect(data.tables.task_tag_links.rows).toEqual([{ task_id: inbox.id, tag_id: tag.id }]);
  });

  test("exports the habits with their logs and pauses, archived and deleted ones included (H1)", async () => {
    const [area] = await testDb
      .insert(lifeAreas)
      .values({ slug: "health", name: "Salud", icon: "heart-pulse", color: "health" })
      .returning();
    const base = { measure: "check", frequency: "daily", startDate: "2026-09-01" } as const;
    const [meditar, , borrado] = await testDb
      .insert(habits)
      .values([
        {
          ...base,
          name: "Meditar",
          lifeAreaId: area.id,
          sortOrder: 0,
          createdAt: new Date("2026-09-01T00:00:00Z"),
        },
        {
          ...base,
          name: "Archivado",
          sortOrder: 1,
          archivedAt: ARCHIVED_AT,
          createdAt: new Date("2026-09-02T00:00:00Z"),
        },
        {
          ...base,
          name: "Borrado",
          sortOrder: 2,
          deletedAt: ARCHIVED_AT,
          createdAt: new Date("2026-09-03T00:00:00Z"),
        },
      ])
      .returning();
    await testDb.insert(habitLogs).values([
      { habitId: meditar.id, day: "2026-09-30", quantity: 1, target: 1 },
      { habitId: borrado.id, day: "2026-09-29", quantity: 0, target: 1 },
    ]);
    await testDb
      .insert(habitPauses)
      .values({ habitId: meditar.id, startDate: "2026-10-10", endDate: "2026-10-20", reason: "Viaje" });

    const data = JSON.parse(JSON.stringify(await buildExport(testDb, NOW))) as DataExport;

    expect(
      data.tables.habits.rows.map((row) => [row.name, row.archived_at, row.deleted_at]),
    ).toEqual([
      ["Meditar", null, null],
      ["Archivado", "2026-09-15T10:00:00.000Z", null],
      ["Borrado", null, "2026-09-15T10:00:00.000Z"],
    ]);
    expect(data.tables.habits.rows[0]).toMatchObject({
      life_area_id: area.id,
      kind: "build",
      measure: "check",
      goal: 1,
      frequency: "daily",
      weekdays: null,
      start_date: "2026-09-01",
      sort_order: 0,
    });
    // Every log, the deleted habit's too (sorted by habit, then day).
    expect(data.tables.habit_logs.rowCount).toBe(2);
    expect(data.tables.habit_logs.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ habit_id: meditar.id, day: "2026-09-30", quantity: 1, target: 1 }),
        expect.objectContaining({ habit_id: borrado.id, day: "2026-09-29", quantity: 0 }),
      ]),
    );
    expect(data.tables.habit_pauses.rows).toEqual([
      expect.objectContaining({
        habit_id: meditar.id,
        start_date: "2026-10-10",
        end_date: "2026-10-20",
        reason: "Viaje",
        deleted_at: null,
      }),
    ]);
  });

  test("never contains auth data: no auth table, no token, hash, key or email", async () => {
    await insertAuthData();
    await testDb
      .insert(lifeAreas)
      .values({ slug: "home", name: "Hogar", icon: "house", color: "home" });

    const json = JSON.stringify(await buildExport(testDb, NOW));

    const parsed = JSON.parse(json) as DataExport;
    expect(Object.keys(parsed.tables).filter((name) => name.startsWith("auth_"))).toEqual([]);
    for (const secret of Object.values(SECRETS)) {
      expect(json).not.toContain(secret);
    }
  });

  test("every table in the database is exported or excluded on purpose", async () => {
    const result = await testDb.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    const decided = [
      ...EXPORTABLE_TABLES.map(({ table }) => getTableName(table)),
      ...EXCLUDED_TABLES,
    ];
    const undecided = result.rows.map((row) => row.tablename).filter((t) => !decided.includes(t));
    expect(undecided).toEqual([]);
  });

  test("reads everything in one read-only, repeatable-read transaction", async () => {
    const spy = vi.spyOn(testDb, "transaction");
    try {
      await buildExport(testDb, NOW);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1]).toEqual({
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("writeExport", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test("writes a private, parseable file and never overwrites one", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "brahua-export-"));
    const outDir = path.join(dir, "exports");
    const data = await buildExport(testDb, NOW);

    const file = await writeExport(outDir, data, NOW);

    expect(path.basename(file)).toBe("brahua-os-2026-10-01T130522Z.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(outDir)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(data)));
    await expect(writeExport(outDir, data, NOW)).rejects.toThrow(/EEXIST/);
  });

  test("tightens an exports folder that already existed with looser permissions", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "brahua-export-"));
    const outDir = path.join(dir, "exports");
    await mkdir(outDir, { mode: 0o755 });
    await chmod(outDir, 0o755);

    await writeExport(outDir, await buildExport(testDb, NOW), NOW);

    expect((await stat(outDir)).mode & 0o777).toBe(0o700);
  });
});
