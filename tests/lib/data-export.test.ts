// @vitest-environment node
import { getTableName, isTable } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import {
  assertExportRegistry,
  EXCLUDED_TABLES,
  EXPORTABLE_TABLES,
  exportFileName,
} from "@/lib/data-export";
import { schema } from "@/lib/db";
import { resolveExportScriptDatabaseUrl } from "@/lib/db-config";
import { authSessions, lifeAreas } from "@/modules/core/db/schema";

const exportedNames = EXPORTABLE_TABLES.map(({ table }) => getTableName(table));
const schemaTableNames = Object.values(schema)
  .filter((value) => isTable(value))
  .map((table) => getTableName(table));

describe("export registry", () => {
  test("every table in the Drizzle schema is exported or excluded on purpose, never both", () => {
    for (const name of schemaTableNames) {
      const exported = exportedNames.includes(name);
      const excluded = EXCLUDED_TABLES.includes(name);
      expect({ name, decided: exported !== excluded }).toEqual({ name, decided: true });
    }
  });

  test("exports the life areas, the four project tables and no auth table", () => {
    expect(exportedNames).toEqual(
      expect.arrayContaining([
        "core_life_areas",
        "projects",
        "project_milestones",
        "project_links",
        "project_dependencies",
      ]),
    );
    expect(exportedNames.filter((name) => name.startsWith("auth_"))).toEqual([]);
    expect(EXCLUDED_TABLES).toEqual(
      expect.arrayContaining([
        "auth_users",
        "auth_sessions",
        "auth_accounts",
        "auth_verifications",
        "auth_passkeys",
        "auth_rate_limits",
      ]),
    );
  });

  test("the registry guard rejects an auth table, an excluded table and duplicates", () => {
    const order = { orderBy: [] };
    expect(() => assertExportRegistry([{ table: authSessions, ...order }], [])).toThrow(
      /must never be exported/,
    );
    expect(() =>
      assertExportRegistry([{ table: lifeAreas, ...order }], ["core_life_areas"]),
    ).toThrow(/must never be exported/);
    expect(() =>
      assertExportRegistry(
        [
          { table: lifeAreas, ...order },
          { table: lifeAreas, ...order },
        ],
        [],
      ),
    ).toThrow(/twice/);
    expect(() => assertExportRegistry(EXPORTABLE_TABLES, EXCLUDED_TABLES)).not.toThrow();
  });
});

describe("export file name", () => {
  test("UTC timestamp, sortable, no colons", () => {
    expect(exportFileName(new Date("2026-10-01T13:05:22.123Z"))).toBe(
      "brahua-os-2026-10-01T130522Z.json",
    );
  });
});

describe("pnpm db:export target", () => {
  const LOCAL = "postgres://postgres:postgres@localhost:54329/brahua_os_test";
  const REMOTE = "postgresql://user:secret@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=require";

  test("only DATABASE_URL_UNPOOLED, never DATABASE_URL", () => {
    expect(() => resolveExportScriptDatabaseUrl({ DATABASE_URL: LOCAL })).toThrow(
      /DATABASE_URL_UNPOOLED is not set/,
    );
    expect(resolveExportScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: LOCAL })).toBe(LOCAL);
  });

  test("a remote host needs ALLOW_PROD_DB=1 (a Vercel build is not permission)", () => {
    expect(() => resolveExportScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE })).toThrow(
      /Refusing/,
    );
    expect(() =>
      resolveExportScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE, VERCEL: "1" }),
    ).toThrow(/Refusing/);
    expect(
      resolveExportScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE, ALLOW_PROD_DB: "1" }),
    ).toBe(REMOTE);
  });

  test("a half-pasted URL fails without echoing it", () => {
    expect(() =>
      resolveExportScriptDatabaseUrl({
        DATABASE_URL_UNPOOLED: "postgresql://owner:secret@…/neondb",
        ALLOW_PROD_DB: "1",
      }),
    ).toThrow(/^(?!.*secret).*no valid host/);
  });
});
