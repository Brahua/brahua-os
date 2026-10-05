// JSON export of the owner's data (`pnpm db:export`, SPEC-core "Operación"). A manual backup that
// is readable without Postgres; the weekly `pg_dump` (.github/workflows/backup.yml) is the full one.
//
// Every table in the database must be either exportable (EXPORTABLE_TABLES) or excluded on purpose
// (EXCLUDED_TABLES): tests fail otherwise, so a new module has to decide.
import { asc, getTableColumns, getTableName, type AnyColumn } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { coreExportTables } from "@/modules/core/export";
import { financeExportTables } from "@/modules/finance/export";
import { habitsExportTables } from "@/modules/habits/export";
import { projectsExportTables } from "@/modules/projects/export";
import { tasksExportTables } from "@/modules/tasks/export";
import type { Database } from "./db";

/**
 * Version of the export format (the JSON shape, not the database schema). Bump it when the
 * envelope changes or a table's columns change in a way an importer must know about.
 */
export const EXPORT_SCHEMA_VERSION = 1;

export const EXPORT_FORMAT = "brahua-os-export";

/** A table a module offers for export, with a stable order so two exports diff cleanly. */
export type ExportableTable = {
  table: PgTable;
  orderBy: AnyColumn[];
};

/** Every module's exportable tables. Add each new module's list here (like `schema` in db.ts). */
export const EXPORTABLE_TABLES: readonly ExportableTable[] = [
  ...coreExportTables,
  ...projectsExportTables,
  ...tasksExportTables,
  ...habitsExportTables,
  ...financeExportTables,
];

/**
 * Tables that are never exported: authentication state and secrets (sessions, password hashes,
 * passkeys, rate-limit counters, verification tokens) and the owner's account, which
 * `pnpm auth:owner` recreates. Restoring them would be a security risk and serves no purpose.
 */
export const EXCLUDED_TABLES: readonly string[] = [
  "auth_users",
  "auth_sessions",
  "auth_accounts",
  "auth_verifications",
  "auth_passkeys",
  "auth_rate_limits",
];

const NOTE =
  "Exportación de datos de brahua-os. No incluye tablas de autenticación (usuario, sesiones, " +
  "cuentas con hashes de contraseña, passkeys, límites de intentos ni verificaciones). " +
  "Contiene datos personales: guárdalo en un lugar privado.";

export type TableExport = {
  rowCount: number;
  /** Rows keyed by SQL column name (snake_case), as stored in Postgres. */
  rows: Record<string, unknown>[];
};

export type DataExport = {
  format: typeof EXPORT_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  note: string;
  excludedTables: string[];
  tables: Record<string, TableExport>;
};

/** Maps Drizzle's property keys (camelCase) back to the SQL column names. */
function toColumnNames(table: PgTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    out[column.name] = row[key];
  }
  return out;
}

/** Fails fast if a table is both exported and excluded, listed twice, or an auth table. */
export function assertExportRegistry(
  tables: readonly ExportableTable[],
  excluded: readonly string[],
): void {
  const seen = new Set<string>();
  for (const { table } of tables) {
    const name = getTableName(table);
    if (seen.has(name)) throw new Error(`Table ${name} is registered for export twice.`);
    if (excluded.includes(name) || name.startsWith("auth_")) {
      throw new Error(`Table ${name} must never be exported.`);
    }
    seen.add(name);
  }
}

/**
 * Reads every exportable table in one read-only, repeatable-read transaction (a consistent
 * snapshot). Archived rows are included: nothing is filtered.
 */
export async function buildExport(
  db: Database,
  now: Date,
  tables: readonly ExportableTable[] = EXPORTABLE_TABLES,
): Promise<DataExport> {
  assertExportRegistry(tables, EXCLUDED_TABLES);
  const result: Record<string, TableExport> = {};
  await db.transaction(
    async (tx) => {
      for (const { table, orderBy } of tables) {
        const rows = await tx
          .select()
          .from(table)
          .orderBy(...orderBy.map((column) => asc(column)));
        result[getTableName(table)] = {
          rowCount: rows.length,
          rows: rows.map((row) => toColumnNames(table, row)),
        };
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    note: NOTE,
    excludedTables: [...EXCLUDED_TABLES],
    tables: result,
  };
}

/** `brahua-os-2026-10-01T130522Z.json` (UTC): sortable, and two exports never share a name. */
export function exportFileName(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "");
  return `brahua-os-${stamp}.json`;
}
