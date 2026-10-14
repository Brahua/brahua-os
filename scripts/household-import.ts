// One-time import of the cleaning of `household` from Notion (SPEC-household "Alcance", decided
// with the owner on 2026-10-14: only the cleaning is imported; products and recipes are typed in):
// the rows of the «Limpieza» database become recurring tasks of `tasks`, tagged `limpieza` and with
// their zone, read from a JSON file that lives OUTSIDE the repo (the owner's data is never
// committed; `/.data/` is ignored for local copies).
//
//   read -rs 'DATABASE_URL_UNPOOLED?URL directa de Neon: ' && export DATABASE_URL_UNPOOLED && echo
//   ALLOW_PROD_DB=1 pnpm db:household:import <file.json> --dry-run   the plan, writes nothing
//   ALLOW_PROD_DB=1 pnpm db:household:import <file.json>             import (idempotent)
//   unset DATABASE_URL_UNPOOLED
//
// The file (validated with Zod, unknown keys refused):
//   {
//     "source": "notion",
//     "exportedAt": "2026-10-14T12:00:00-05:00",            ISO date or date-time
//     "cleanings": [{
//       "notionId": "<32 hex, dashes allowed>",
//       "title": "Limpiar inodoro",                       «Tarea»
//       "zone": "Baño" | null,                            «Zona» (any text; «Cocina/Lavanderia» is fixed)
//       "frequency": "Diario" | "Semanal" | "Quincenal" | "Mensual" | "Trimestral",   «Periodicidad»
//       "weekday": "Lunes" | … | "Domingo" | null,        «Día» (accents optional)
//       "nextDate": "2026-10-19" | null,                  «Próxima vez»
//       "completed": false                                «Completado»
//     }]
//   }
//
// Mapping (the same rules as the «Añadir limpieza» form, src/modules/household/cleaning.ts):
// Diario = every day · Semanal = that weekday (the weekday of `nextDate` when «Día» is empty, and
// the weekday of today when neither exists, with a warning) · Quincenal = every 2 weeks · Mensual =
// every month · Trimestral = every 3 months. A «Próxima vez» in the past (or none) starts at the
// first day that fits on or after the import day in Lima, so nothing shows as overdue on day one. A
// row marked «Completado» is imported as pending (Notion used the box as a reset; a warning counts
// them). The task is created in the inbox (no area, no project) with the tags `limpieza` and
// `zona: <zone>`.
//
// Ids are deterministic (UUID v5 under HOUSEHOLD_IMPORT_NAMESPACE, from the Notion id) and every
// insert is `ON CONFLICT (id) DO NOTHING`: a second run inserts nothing, and a task the owner
// edited, completed or deleted after the import is never overwritten. A row whose title (any case)
// is already a pending cleaning is skipped with a warning (it was typed by hand). One transaction
// under `(7000, hashtext('household:import'))`, taken first: a failure leaves nothing half done.
//
// Safety, like `db:finance:import`: only DATABASE_URL_UNPOOLED; a non-local host needs
// ALLOW_PROD_DB=1, a successful production backup finished less than BACKUP_MAX_AGE_HOURS ago with
// its artifact (checked with `gh`), typing the host back and the word "importar". `--dry-run` runs
// read-only and asks nothing. Nothing prints the URL, a secret or a Postgres message
// (`describeError`); titles and zones show in the plan (the owner's own terminal).
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { createDb } from "@/lib/db";
import {
  databaseHost,
  describeDatabaseTarget,
  isLocalDatabaseUrl,
  resolveOwnerScriptDatabaseUrl,
} from "@/lib/db-config";
import { describeError } from "@/lib/describe-error";
import { hasInvisibleCharacters, normalizeName } from "@/lib/text";
import { ownerDateKey } from "@/lib/time";
import {
  CLEANING_TAG,
  CLEANING_TITLE_MAX_LENGTH,
  ZONE_MAX_LENGTH,
  isoWeekdayOf,
  nextWeekdayOnOrAfter,
  recurrenceFor,
  zoneTagName,
  type Frequency,
} from "@/modules/household/cleaning";
import { HOUSEHOLD_ADVISORY_SPACE } from "@/modules/household/lock-keys";
import { taskTagLinks, taskTags, tasks } from "@/modules/tasks/db/schema";
import { CONFIRM_WORD, assessBackup, gate, readLatestBackup } from "./finance-import";
import { CANCELLED, prompt } from "./terminal-prompt";
import { uuidV5 } from "./uuid-v5";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

// ── Ids ─────────────────────────────────────────────────────────────────────────────────────────

/** Fixed namespace of this import: every id is UUID v5(key, HOUSEHOLD_IMPORT_NAMESPACE). Never change. */
export const HOUSEHOLD_IMPORT_NAMESPACE = "81d2193f-0a65-43fd-b552-1ea4d99e54aa";

/** A Notion id as a key: lowercase, without dashes (Notion shows both forms). */
export const notionKey = (notionId: string) => notionId.replace(/-/g, "").toLowerCase();

export const importCleaningId = (notionId: string) =>
  uuidV5(`cleaning:${notionKey(notionId)}`, HOUSEHOLD_IMPORT_NAMESPACE);

/** The lock that serializes two imports at once (the first lock of the transaction). */
export const IMPORT_LOCK_KEY = "household:import";

// ── The file ────────────────────────────────────────────────────────────────────────────────────

/** Notion's «Periodicidad» options and what they mean. */
export const FREQUENCY_BY_NOTION = {
  Diario: "daily",
  Semanal: "weekly",
  Quincenal: "biweekly",
  Mensual: "monthly",
  Trimestral: "quarterly",
} as const satisfies Record<string, Frequency>;

/** Notion's «Día» options without accents or case, to ISO weekdays. */
const WEEKDAY_BY_NAME: Record<string, number> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};

const stripAccents = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Zones whose Notion spelling lacks an accent the app uses. */
const ZONE_FIXES: Record<string, string> = { "cocina/lavanderia": "Cocina/Lavandería" };

const notionId = z
  .string()
  .refine((value) => /^[0-9a-f]{32}$/.test(notionKey(value)), "Not a Notion id (32 hex digits)");

const text = (max: number, what: string) =>
  z
    .string()
    .transform(normalizeName)
    .pipe(
      z
        .string()
        .min(1, `Empty ${what}`)
        .refine((value) => [...value].length <= max, `${what} longer than ${max} characters`)
        .refine((value) => !hasInvisibleCharacters(value), `${what} with invisible characters`),
    );

export const importFileSchema = z
  .strictObject({
    source: z.literal("notion"),
    exportedAt: z.union([z.iso.datetime({ offset: true }), z.iso.date()]),
    cleanings: z.array(
      z.strictObject({
        notionId,
        title: text(CLEANING_TITLE_MAX_LENGTH, "Title"),
        zone: text(ZONE_MAX_LENGTH, "Zone")
          .refine((value) => !value.includes(","), "Zone with a comma")
          .nullable(),
        frequency: z.enum(Object.keys(FREQUENCY_BY_NOTION) as [keyof typeof FREQUENCY_BY_NOTION]),
        weekday: z
          .string()
          .refine((value) => stripAccents(value.trim()) in WEEKDAY_BY_NAME, "Unknown weekday")
          .nullable(),
        nextDate: z.iso.date().nullable(),
        completed: z.boolean(),
      }),
    ),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.cleanings.forEach((row, index) => {
      const key = notionKey(row.notionId);
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["cleanings", index], message: "Repeated notionId" });
      }
      seen.add(key);
    });
  });

export type ImportFile = z.output<typeof importFileSchema>;

/** The file's problems, by path (Zod's messages hold no input values). */
export function describeFileIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join(".") || "(file)"}: ${issue.message}`)
    .join("\n");
}

// ── Plan (pure) ─────────────────────────────────────────────────────────────────────────────────

export type PlannedCleaning = {
  id: string;
  title: string;
  zone: string | null;
  frequency: Frequency;
  dueDate: string;
  tags: string[];
  recurrence: ReturnType<typeof recurrenceFor>;
};

export type ImportPlan = { cleanings: PlannedCleaning[]; warnings: string[] };

/** The rows the file maps to, with the warnings, for Lima's `today`. */
export function planImport(file: ImportFile, today: string): ImportPlan {
  const warnings: string[] = [];
  let completed = 0;
  let moved = 0;
  const cleanings = file.cleanings.map((row) => {
    const frequency: Frequency = FREQUENCY_BY_NOTION[row.frequency];
    let weekdays: number[] = [];
    if (frequency === "weekly") {
      const named = row.weekday ? WEEKDAY_BY_NAME[stripAccents(row.weekday.trim())] : null;
      const fromDate = row.nextDate ? isoWeekdayOf(row.nextDate) : null;
      const day = named ?? fromDate;
      if (day === null) {
        warnings.push(`«${row.title}»: Semanal sin día ni fecha; se importa el día de hoy.`);
        weekdays = [isoWeekdayOf(today)];
      } else {
        weekdays = [day];
      }
    }
    const recurrence = recurrenceFor(frequency, weekdays);
    // The first day that fits, on or after today: the Notion date when it is still ahead (and, for
    // a weekly one, on the weekday it repeats on).
    const keepsDate =
      row.nextDate !== null &&
      row.nextDate >= today &&
      (frequency !== "weekly" || weekdays.includes(isoWeekdayOf(row.nextDate)));
    const dueDate = keepsDate
      ? (row.nextDate as string)
      : frequency === "weekly"
        ? nextWeekdayOnOrAfter(today, weekdays)
        : today;
    if (row.nextDate !== null && row.nextDate < today) moved += 1;
    if (row.completed) completed += 1;
    const zone = row.zone === null ? null : (ZONE_FIXES[stripAccents(row.zone)] ?? row.zone);
    return {
      id: importCleaningId(row.notionId),
      title: row.title,
      zone,
      frequency,
      dueDate,
      tags: [CLEANING_TAG, ...(zone ? [zoneTagName(zone)] : [])],
      recurrence,
    };
  });
  if (moved > 0) {
    warnings.push(`${moved} con «Próxima vez» ya pasada: empiezan en su primer día posible.`);
  }
  if (completed > 0) {
    warnings.push(`${completed} marcadas «Completado» en Notion: se importan pendientes.`);
  }
  return { cleanings, warnings };
}

// ── Import ──────────────────────────────────────────────────────────────────────────────────────

/** Our own refusals: safe to print (names only, never values from Postgres). */
export class HouseholdImportError extends Error {
  override name = "HouseholdImportError";
}

export type ImportReport = {
  dryRun: boolean;
  today: string;
  exportedAt: string;
  /** New tasks (or what a dry run would create). */
  inserted: number;
  /** Already imported earlier (same id): left as they are. */
  skipped: number;
  /** Not imported: a pending cleaning with the same title already exists. */
  sameTitle: number;
  byFrequency: Record<Frequency, number>;
  warnings: string[];
};

/**
 * Imports the file in one transaction (see the header). `dryRun` runs the same reads in a READ ONLY
 * transaction and reports what a real run would insert.
 */
export async function importHousehold(
  db: Database,
  file: ImportFile,
  now: Date,
  { dryRun }: { dryRun: boolean },
): Promise<ImportReport> {
  const today = ownerDateKey(now);
  const plan = planImport(file, today);
  const warnings = [...plan.warnings];
  return db.transaction(async (tx: Tx) => {
    if (dryRun) await tx.execute(sql`set transaction read only`);
    else {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${sql.raw(String(HOUSEHOLD_ADVISORY_SPACE))}, hashtext(${IMPORT_LOCK_KEY}))`,
      );
    }

    const ids = plan.cleanings.map((row) => row.id);
    const have = new Set<string>();
    if (ids.length > 0) {
      const found = await tx.execute<{ id: string }>(
        sql`select id from tasks where id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );
      for (const row of found.rows) have.add(row.id);
    }
    // Pending, visible cleanings by title (lowercase): typed by hand before the import.
    const pending = await tx.execute<{ title: string }>(
      sql`select lower(t.title) as title from tasks t
          join task_tag_links l on l.task_id = t.id
          join task_tags g on g.id = l.tag_id
          where g.name = ${CLEANING_TAG} and t.done_at is null and t.deleted_at is null`,
    );
    const titles = new Set(pending.rows.map((row) => row.title));

    const fresh: PlannedCleaning[] = [];
    let sameTitle = 0;
    for (const row of plan.cleanings) {
      if (have.has(row.id)) continue;
      if (titles.has(row.title.toLowerCase())) {
        sameTitle += 1;
        warnings.push(
          `«${row.title}»: ya hay una limpieza pendiente con ese título; no se importa.`,
        );
        continue;
      }
      titles.add(row.title.toLowerCase());
      fresh.push(row);
    }

    let inserted = fresh.length;
    if (!dryRun && fresh.length > 0) {
      const created = await tx
        .insert(tasks)
        .values(
          fresh.map((row) => ({
            id: row.id,
            title: row.title,
            dueDate: row.dueDate,
            recurrenceKind: row.recurrence.kind,
            recurrenceInterval: row.recurrence.interval,
            recurrenceWeekdays: row.recurrence.weekdays,
            recurrenceMonthDay: row.recurrence.monthDay,
          })),
        )
        .onConflictDoNothing({ target: tasks.id })
        .returning({ id: tasks.id });
      inserted = created.length;
      const createdIds = new Set(created.map((row) => row.id));
      const names = [...new Set(fresh.flatMap((row) => row.tags))].sort();
      await tx
        .insert(taskTags)
        .values(names.map((name) => ({ name })))
        .onConflictDoNothing({ target: taskTags.name });
      const tagRows = await tx.select({ id: taskTags.id, name: taskTags.name }).from(taskTags);
      const tagId = new Map(tagRows.map((row) => [row.name, row.id]));
      const links = fresh
        .filter((row) => createdIds.has(row.id))
        .flatMap((row) =>
          row.tags.map((name) => ({ taskId: row.id, tagId: tagId.get(name) as string })),
        );
      if (links.length > 0) await tx.insert(taskTagLinks).values(links).onConflictDoNothing();
    }

    const byFrequency = { daily: 0, weekly: 0, biweekly: 0, monthly: 0, quarterly: 0 } as Record<
      Frequency,
      number
    >;
    for (const row of plan.cleanings) byFrequency[row.frequency] += 1;
    return {
      dryRun,
      today,
      exportedAt: file.exportedAt,
      inserted,
      skipped: have.size,
      sameTitle,
      byFrequency,
      warnings,
    };
  });
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

export type Args = { ok: true; file: string; dryRun: boolean } | { ok: false; message: string };

const USAGE = "Usage: pnpm db:household:import <file.json> [--dry-run]";

export function parseArgs(argv: readonly string[]): Args {
  const dryRun = argv.includes("--dry-run");
  const rest = argv.filter((arg) => arg !== "--dry-run");
  if (rest.length !== 1 || rest[0].startsWith("-")) return { ok: false, message: USAGE };
  return { ok: true, file: rest[0], dryRun };
}

/** Reads and validates the file. Throws HouseholdImportError (paths and messages only). */
export async function loadImportFile(path: string): Promise<ImportFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new HouseholdImportError(`Could not read ${path} as JSON.`);
  }
  const parsed = importFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HouseholdImportError(`The file is not valid:\n${describeFileIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function formatReport(report: ImportReport): string {
  const verb = report.dryRun ? "would insert" : "inserted";
  const f = report.byFrequency;
  const lines = [
    `${report.dryRun ? "Plan (dry run, nothing written)" : "Imported"} for ${report.today} (Lima), Notion export of ${report.exportedAt}:`,
    `  cleanings: ${verb} ${report.inserted}, already there (left as they are) ${report.skipped}, same title as a pending one ${report.sameTitle}`,
    `  in the file: ${f.daily} diarias, ${f.weekly} semanales, ${f.biweekly} quincenales, ${f.monthly} mensuales, ${f.quarterly} trimestrales`,
  ];
  if (report.warnings.length) {
    lines.push(`Warnings (${report.warnings.length}):`, ...report.warnings.map((w) => `  - ${w}`));
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ok) return fail(args.message);
  const file = await loadImportFile(args.file);
  let url: string;
  try {
    url = resolveOwnerScriptDatabaseUrl(process.env);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const check = gate(args.dryRun, isLocalDatabaseUrl(url), Boolean(process.stdin.isTTY));
  if (!check.ok) return fail(check.message);

  console.log(`Target database: ${describeDatabaseTarget(url)}`);
  const db = createDb(url);
  try {
    const plan = await importHousehold(db, file, new Date(), { dryRun: true });
    console.log(formatReport(plan));
    if (args.dryRun) return;

    if (check.checkBackup) {
      const latest = await readLatestBackup().catch(() => {
        throw new HouseholdImportError("Could not read the backups with `gh` (is it logged in?).");
      });
      const backup = assessBackup(latest.run, latest.artifacts, new Date());
      if (!backup.ok) return fail(backup.message);
      console.log(`Backup verified: run ${backup.runId}.`);
    }
    if (check.askHost) {
      const host = databaseHost(url);
      const typed = await prompt(`Remote database. Type its host (${host}) to continue: `, {
        hidden: false,
      });
      if (typed.trim() !== host) return fail("The host does not match. Nothing was changed.");
      const word = await prompt(`Type ${CONFIRM_WORD} to import: `, { hidden: false });
      if (word.trim() !== CONFIRM_WORD) return fail("Not confirmed. Nothing was changed.");
    }
    console.log(formatReport(await importHousehold(db, file, new Date(), { dryRun: false })));
  } finally {
    await db.$client.end();
  }
}

function fail(message: string) {
  console.error(message);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    // Our own messages are safe; anything else (Postgres, Drizzle) may quote values.
    if (
      error instanceof HouseholdImportError ||
      (error instanceof Error && error.message === CANCELLED)
    ) {
      console.error(error.message);
    } else {
      console.error(
        "Failed; the transaction was not confirmed. Nothing was imported.",
        describeError(error),
      );
    }
    process.exit(1);
  });
}
