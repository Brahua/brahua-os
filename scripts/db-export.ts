// Writes a JSON export of the owner's data to exports/ (gitignored). Read-only on the database.
//   DATABASE_URL_UNPOOLED=… ALLOW_PROD_DB=1 pnpm db:export
// Auth tables (sessions, password hashes, passkeys…) are never exported: see src/lib/data-export.ts.
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildExport, exportFileName, type DataExport } from "@/lib/data-export";
import { createDb } from "@/lib/db";
import { describeDatabaseTarget, resolveExportScriptDatabaseUrl } from "@/lib/db-config";

export const EXPORT_DIR = "exports";

/**
 * Writes the export as `<dir>/brahua-os-<timestamp>.json`, readable only by the current user
 * (the folder is made 0700, even if it already existed).
 * Never overwrites an existing file. Returns the path.
 */
export async function writeExport(dir: string, data: DataExport, now: Date): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir keeps the mode of a folder that already existed.
  await chmod(dir, 0o700);
  const file = path.join(dir, exportFileName(now));
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return file;
}

async function main() {
  let url: string;
  try {
    url = resolveExportScriptDatabaseUrl(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  console.log(`Target database: ${describeDatabaseTarget(url)}`);
  const db = createDb(url);
  try {
    const now = new Date();
    const data = await buildExport(db, now);
    const file = await writeExport(EXPORT_DIR, data, now);
    for (const [name, table] of Object.entries(data.tables)) {
      console.log(`  ${name}: ${table.rowCount} row(s)`);
    }
    console.log(`Export written to ${file} (auth tables excluded).`);
  } finally {
    await db.$client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
