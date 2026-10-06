// One-time import of `finance` from Notion (SPEC-finance "Importación desde Notion"): categories,
// payment methods and recurring payments (active and inactive), read from a JSON file that lives
// OUTSIDE the repo (financial data is never committed; `/.data/` is ignored for local copies).
//
//   read -rs 'DATABASE_URL_UNPOOLED?URL directa de Neon: ' && export DATABASE_URL_UNPOOLED && echo
//   ALLOW_PROD_DB=1 pnpm db:finance:import <file.json> --dry-run   the plan, writes nothing
//   ALLOW_PROD_DB=1 pnpm db:finance:import <file.json>             import (idempotent)
//   unset DATABASE_URL_UNPOOLED
//
// The file (validated with Zod, unknown keys refused):
//   {
//     "source": "notion",
//     "exportedAt": "2026-10-05T12:00:00-05:00",            ISO date or date-time
//     "categories": [{ "notionId": "<32 hex, dashes allowed>", "name": "Servicios" }],
//     "paymentMethods": [{ "name": "Débito dólares", "currency": "USD" }],   PEN | USD
//     "recurring": [{
//       "notionId": "<32 hex>", "name": "Servicio A",
//       "amount": 49.9,            PEN as in Notion, ≤ 2 decimals; null = variable
//       "dayOfMonth": 15,          1–31 (monthly; 31 → the month's last day)
//       "active": true,            false → archived
//       "paymentMethod": "Débito dólares",   a method's name (any case) or null
//       "category": "<a category's notionId>"  or null
//     }]
//   }
// Methods are keyed by name: Notion's select options have no stable page id. So a method's id comes
// from its normalized name: renaming a method in the app and running the import again creates a
// second method with the old name (acceptable for a one-off import).
//
// Mapping: monthly cycle on `dayOfMonth`, currency PEN, amount null → variable, active=false →
// archived (archived_at = the run's instant). Every recurring payment starts at its next due date
// on or after the import day in Lima (`nextDueDate`), so nothing shows as overdue on day one (one
// due today shows as due today). A method's currency is the file's (warning when the name says
// dólares/USD but the currency is PEN). A reference to an unknown method or category becomes null,
// with a warning.
//
// Ids are deterministic (UUID v5 under FINANCE_IMPORT_NAMESPACE: from the Notion id for categories
// and recurring payments, from the normalized lowercase name for methods), and every insert is
// `ON CONFLICT (id) DO NOTHING`: a second run inserts nothing, and a row the owner edited, archived
// or deleted after the import is never overwritten (the summary says inserted vs skipped). New
// catalog rows go after every existing one (sort_order contiguous from max + 1) under the
// catalog locks, taken first: (5000, hashtext('finance:categories')), then
// (5000, hashtext('finance:methods')), the two-key rule of `finance` (catalog.ts). A name that
// clashes (any case) with a visible catalog row of another id aborts the whole import: nothing is
// written. One transaction: a failure leaves nothing half done.
//
// Safety, like `db:demo`: only DATABASE_URL_UNPOOLED; a non-local host needs ALLOW_PROD_DB=1
// (`VERCEL=1` is not permission), a successful production backup (backup.yml on main) finished
// less than BACKUP_MAX_AGE_HOURS ago with its artifact (checked with `gh`), typing the host back
// and the word "importar". `--dry-run` runs read-only (a READ ONLY transaction) and asks nothing.
// Nothing prints the URL, a secret, an amount or a Postgres message (`describeError`); names show
// in the plan and the warnings (the owner's own terminal).
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { sql, type SQL } from "drizzle-orm";
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
  financeCategories,
  financePaymentMethods,
  financeRecurringPayments,
} from "@/modules/finance/db/schema";
import {
  CATALOG_NAME_MAX_LENGTH,
  CURRENCIES,
  RECURRING_NAME_MAX_LENGTH,
  type Currency,
} from "@/modules/finance/finance-constants";
import {
  FINANCE_ADVISORY_SPACE,
  FINANCE_CATEGORIES_KEY,
  FINANCE_METHODS_KEY,
} from "@/modules/finance/lock-keys";
import { parseAmount } from "@/modules/finance/money";
import { nextDueDate } from "@/modules/finance/schedule";
import { CANCELLED, prompt } from "./terminal-prompt";
import { uuidV5 } from "./uuid-v5";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

// ── Ids ─────────────────────────────────────────────────────────────────────────────────────────

/** Fixed namespace of this import: every id is UUID v5(key, FINANCE_IMPORT_NAMESPACE). Never change. */
export const FINANCE_IMPORT_NAMESPACE = "449bcdfc-d2e6-4ee5-9fba-239971c7d3ea";

/** A Notion id as a key: lowercase, without dashes (Notion shows both forms). */
export const notionKey = (notionId: string) => notionId.replace(/-/g, "").toLowerCase();

/** A method's name as a key: normalized like stored names, lowercase. */
export const methodKey = (name: string) => normalizeName(name).toLowerCase();

export const importCategoryId = (notionId: string) =>
  uuidV5(`category:${notionKey(notionId)}`, FINANCE_IMPORT_NAMESPACE);
export const importMethodId = (name: string) =>
  uuidV5(`method:${methodKey(name)}`, FINANCE_IMPORT_NAMESPACE);
export const importRecurringId = (notionId: string) =>
  uuidV5(`recurring:${notionKey(notionId)}`, FINANCE_IMPORT_NAMESPACE);

// ── The file ────────────────────────────────────────────────────────────────────────────────────

const notionId = z
  .string()
  .refine((value) => /^[0-9a-f]{32}$/.test(notionKey(value)), "Not a Notion id (32 hex digits)");

const nameOf = (max: number) =>
  z
    .string()
    .transform(normalizeName)
    .pipe(
      z
        .string()
        .min(1, "Empty name")
        .max(max, `Name longer than ${max} characters`)
        .refine((value) => !hasInvisibleCharacters(value), "Name with invisible characters"),
    );

/** PEN as in Notion: > 0, ≤ 1 000 000, at most 2 decimals. Never a float in the database. */
const amount = z
  .number()
  .nullable()
  .refine(
    (value) => value === null || parseAmount(String(value)).ok,
    "Amount must be > 0, ≤ 1000000 and have at most 2 decimals (null = variable)",
  );

export const importFileSchema = z
  .strictObject({
    source: z.literal("notion"),
    exportedAt: z.union([z.iso.datetime({ offset: true }), z.iso.date()]),
    categories: z.array(z.strictObject({ notionId, name: nameOf(CATALOG_NAME_MAX_LENGTH) })),
    paymentMethods: z.array(
      z.strictObject({ name: nameOf(CATALOG_NAME_MAX_LENGTH), currency: z.enum(CURRENCIES) }),
    ),
    recurring: z.array(
      z.strictObject({
        notionId,
        name: nameOf(RECURRING_NAME_MAX_LENGTH),
        amount,
        dayOfMonth: z.number().int().min(1).max(31),
        active: z.boolean(),
        paymentMethod: z
          .string()
          .refine((value) => !hasInvisibleCharacters(value), "Name with invisible characters")
          .nullable(),
        category: notionId.nullable(),
      }),
    ),
  })
  .superRefine((file, ctx) => {
    // Two entries with one id (or one visible name) would collide in the database.
    const unique = (list: string[], path: (string | number)[], what: string) => {
      const seen = new Set<string>();
      list.forEach((key, index) => {
        if (seen.has(key)) ctx.addIssue({ code: "custom", path: [...path, index], message: what });
        seen.add(key);
      });
    };
    unique(
      file.categories.map((c) => notionKey(c.notionId)),
      ["categories"],
      "Repeated notionId",
    );
    unique(
      file.categories.map((c) => c.name.toLowerCase()),
      ["categories"],
      "Repeated name",
    );
    unique(
      file.paymentMethods.map((m) => methodKey(m.name)),
      ["paymentMethods"],
      "Repeated name",
    );
    unique(
      file.recurring.map((r) => notionKey(r.notionId)),
      ["recurring"],
      "Repeated notionId",
    );
  });

export type ImportFile = z.output<typeof importFileSchema>;

/** The file's problems, by path (Zod's messages hold no input values). */
export function describeFileIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join(".") || "(file)"}: ${issue.message}`)
    .join("\n");
}

// ── Plan (pure) ─────────────────────────────────────────────────────────────────────────────────

export type PlannedCategory = { id: string; name: string };
export type PlannedMethod = { id: string; name: string; currency: Currency };
export type PlannedRecurring = {
  id: string;
  name: string;
  amountCents: number | null;
  dayOfMonth: number;
  startDate: string;
  active: boolean;
  categoryId: string | null;
  paymentMethodId: string | null;
};

export type ImportPlan = {
  categories: PlannedCategory[];
  methods: PlannedMethod[];
  recurring: PlannedRecurring[];
  warnings: string[];
};

const LOOKS_USD = /d[oó]lar|usd/i;

/** The first due date of a monthly payment on `dayOfMonth`, on or after `today` (Lima). */
export function firstDueFrom(dayOfMonth: number, today: string): string {
  return nextDueDate(
    {
      cycle: "monthly",
      weekday: null,
      dayOfMonth,
      intervalMonths: null,
      anchorMonth: null,
      startDate: today,
    },
    today,
  );
}

/** The rows the file maps to (SPEC-finance mapping), with the warnings, for Lima's `today`. */
export function planImport(file: ImportFile, today: string): ImportPlan {
  const warnings: string[] = [];
  const categories = file.categories.map((category) => ({
    id: importCategoryId(category.notionId),
    name: category.name,
  }));
  const categoryIds = new Set(categories.map((category) => category.id));
  const methods = file.paymentMethods.map((method) => {
    if (method.currency === "PEN" && LOOKS_USD.test(method.name)) {
      warnings.push(`Method "${method.name}" looks like USD but the file says PEN (kept PEN).`);
    }
    return { id: importMethodId(method.name), name: method.name, currency: method.currency };
  });
  const methodIds = new Set(methods.map((method) => method.id));
  const usdMethodIds = new Set(
    methods.filter((method) => method.currency === "USD").map((method) => method.id),
  );

  const recurring = file.recurring.map((item) => {
    let categoryId: string | null = null;
    if (item.category !== null) {
      const id = importCategoryId(item.category);
      if (categoryIds.has(id)) categoryId = id;
      else {
        warnings.push(
          `"${item.name}": unknown category ${JSON.stringify(item.category)} (left without one).`,
        );
      }
    }
    let paymentMethodId: string | null = null;
    if (item.paymentMethod !== null) {
      const id = importMethodId(item.paymentMethod);
      if (methodIds.has(id)) {
        paymentMethodId = id;
        // Amounts come in PEN as in Notion (SPEC-finance); the owner fixes the currency in the app.
        if (usdMethodIds.has(id)) {
          warnings.push(
            `«${item.name}»: se paga con un medio en USD; se importa en PEN (revísalo en la app)`,
          );
        }
      } else {
        warnings.push(
          `"${item.name}": unknown payment method ${JSON.stringify(item.paymentMethod)} (left without one).`,
        );
      }
    }
    const parsed = item.amount === null ? null : parseAmount(String(item.amount));
    return {
      id: importRecurringId(item.notionId),
      name: item.name,
      amountCents: parsed?.ok ? parsed.value : null,
      dayOfMonth: item.dayOfMonth,
      startDate: firstDueFrom(item.dayOfMonth, today),
      active: item.active,
      categoryId,
      paymentMethodId,
    };
  });
  return { categories, methods, recurring, warnings };
}

// ── Import ──────────────────────────────────────────────────────────────────────────────────────

/** Our own refusals: safe to print (names only, never values from Postgres). */
export class FinanceImportError extends Error {
  override name = "FinanceImportError";
}

export type Counts = { inserted: number; skipped: number };

export type ImportReport = {
  dryRun: boolean;
  today: string;
  /** The file's `exportedAt`, shown in the plan. */
  exportedAt: string;
  categories: Counts;
  methods: Counts;
  recurring: Counts & { active: number; archived: number; variable: number };
  warnings: string[];
};

/** The advisory locks of a real import, in order: `[space, key]` (catalog.ts's two-key rule). */
export const IMPORT_LOCKS: readonly [number, string][] = [
  [FINANCE_ADVISORY_SPACE, FINANCE_CATEGORIES_KEY],
  [FINANCE_ADVISORY_SPACE, FINANCE_METHODS_KEY],
];

const list = (values: readonly string[]) =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

async function existingIds(tx: Tx, table: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const result = await tx.execute<{ id: string }>(
    sql`select id from ${sql.identifier(table)} where id in (${list(ids)})`,
  );
  return new Set(result.rows.map((row) => row.id));
}

/** Names among `names` taken (any case) by a visible row of the table. */
async function takenNames(tx: Tx, table: string, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const lowered: SQL = sql.join(
    names.map((name) => sql`lower(${name})`),
    sql`, `,
  );
  const result = await tx.execute<{ name: string }>(
    sql`select name from ${sql.identifier(table)}
        where archived_at is null and lower(name) in (${lowered})`,
  );
  return result.rows.map((row) => row.name);
}

async function nextSortOrder(tx: Tx, table: string): Promise<number> {
  const result = await tx.execute<{ next: number }>(
    sql`select coalesce(max(sort_order) + 1, 0)::int as next from ${sql.identifier(table)}`,
  );
  return Number(result.rows[0]?.next ?? 0);
}

/**
 * Imports the file in one transaction (see the header): catalog locks first, rows already there
 * (by id) skipped, a name clash aborts before writing. `dryRun` runs the same reads in a READ ONLY
 * transaction and reports what a real run would insert.
 */
export async function importFinance(
  db: Database,
  file: ImportFile,
  now: Date,
  { dryRun }: { dryRun: boolean },
): Promise<ImportReport> {
  const today = ownerDateKey(now);
  const plan = planImport(file, today);
  return db.transaction(async (tx) => {
    if (dryRun) await tx.execute(sql`set transaction read only`);
    else {
      for (const [space, key] of IMPORT_LOCKS) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${sql.raw(String(space))}, hashtext(${key}))`,
        );
      }
    }

    const haveCategories = await existingIds(
      tx,
      "finance_categories",
      plan.categories.map((row) => row.id),
    );
    const haveMethods = await existingIds(
      tx,
      "finance_payment_methods",
      plan.methods.map((row) => row.id),
    );
    const haveRecurring = await existingIds(
      tx,
      "finance_recurring_payments",
      plan.recurring.map((row) => row.id),
    );
    const newCategories = plan.categories.filter((row) => !haveCategories.has(row.id));
    const newMethods = plan.methods.filter((row) => !haveMethods.has(row.id));
    const newRecurring = plan.recurring.filter((row) => !haveRecurring.has(row.id));

    const clashes = [
      ...(
        await takenNames(
          tx,
          "finance_categories",
          newCategories.map((row) => row.name),
        )
      ).map((name) => `category "${name}"`),
      ...(
        await takenNames(
          tx,
          "finance_payment_methods",
          newMethods.map((row) => row.name),
        )
      ).map((name) => `payment method "${name}"`),
    ];
    if (clashes.length) {
      throw new FinanceImportError(
        `These names already exist (any case) with another id: ${clashes.join(", ")}. ` +
          "Rename or archive them in the app, or fix the file. Nothing was written.",
      );
    }

    let insertedCategories = newCategories.length;
    let insertedMethods = newMethods.length;
    let insertedRecurring = newRecurring.length;
    if (!dryRun) {
      const categoryBase = await nextSortOrder(tx, "finance_categories");
      const methodBase = await nextSortOrder(tx, "finance_payment_methods");
      insertedCategories = newCategories.length
        ? (
            await tx
              .insert(financeCategories)
              .values(
                newCategories.map((row, index) => ({ ...row, sortOrder: categoryBase + index })),
              )
              .onConflictDoNothing({ target: financeCategories.id })
              .returning({ id: financeCategories.id })
          ).length
        : 0;
      insertedMethods = newMethods.length
        ? (
            await tx
              .insert(financePaymentMethods)
              .values(newMethods.map((row, index) => ({ ...row, sortOrder: methodBase + index })))
              .onConflictDoNothing({ target: financePaymentMethods.id })
              .returning({ id: financePaymentMethods.id })
          ).length
        : 0;
      insertedRecurring = newRecurring.length
        ? (
            await tx
              .insert(financeRecurringPayments)
              .values(
                newRecurring.map((row) => ({
                  id: row.id,
                  name: row.name,
                  amountCents: row.amountCents,
                  currency: "PEN" as const,
                  categoryId: row.categoryId,
                  paymentMethodId: row.paymentMethodId,
                  cycle: "monthly" as const,
                  dayOfMonth: row.dayOfMonth,
                  startDate: row.startDate,
                  archivedAt: row.active ? null : now,
                })),
              )
              .onConflictDoNothing({ target: financeRecurringPayments.id })
              .returning({ id: financeRecurringPayments.id })
          ).length
        : 0;
    }

    return {
      dryRun,
      today,
      exportedAt: file.exportedAt,
      categories: {
        inserted: insertedCategories,
        skipped: plan.categories.length - insertedCategories,
      },
      methods: { inserted: insertedMethods, skipped: plan.methods.length - insertedMethods },
      recurring: {
        inserted: insertedRecurring,
        skipped: plan.recurring.length - insertedRecurring,
        active: plan.recurring.filter((row) => row.active).length,
        archived: plan.recurring.filter((row) => !row.active).length,
        variable: plan.recurring.filter((row) => row.amountCents === null).length,
      },
      warnings: plan.warnings,
    };
  });
}

// ── Backup check ────────────────────────────────────────────────────────────────────────────────

export const BACKUP_REPO = "Brahua/brahua-os";
/** A remote import needs a production backup that finished at most this long ago. */
export const BACKUP_MAX_AGE_HOURS = 3;

export type BackupRun = { databaseId: number; conclusion: string; updatedAt: string } | null;

/**
 * Whether the latest successful backup run of `main` (backup.yml only dumps production there)
 * is recent enough and kept its artifact. Pure: `readLatestBackup` asks `gh`.
 */
export function assessBackup(
  run: BackupRun,
  artifacts: number,
  now: Date,
): { ok: true; runId: number } | { ok: false; message: string } {
  const howTo = `Run it first: gh workflow run backup.yml -R ${BACKUP_REPO}, then gh run watch <id>.`;
  if (!run || run.conclusion !== "success") {
    return { ok: false, message: `No successful production backup found. ${howTo}` };
  }
  const ageMs = now.getTime() - new Date(run.updatedAt).getTime();
  if (!(ageMs >= 0 && ageMs <= BACKUP_MAX_AGE_HOURS * 3_600_000)) {
    return {
      ok: false,
      message: `The latest production backup (run ${run.databaseId}) is older than ${BACKUP_MAX_AGE_HOURS} h. ${howTo}`,
    };
  }
  if (artifacts < 1) {
    return {
      ok: false,
      message: `The backup run ${run.databaseId} has no artifact left. ${howTo}`,
    };
  }
  return { ok: true, runId: run.databaseId };
}

const run = promisify(execFile);

async function readLatestBackup(): Promise<{ run: BackupRun; artifacts: number }> {
  const { stdout } = await run("gh", [
    "run",
    "list",
    "-R",
    BACKUP_REPO,
    "--workflow",
    "backup.yml",
    "--branch",
    "main",
    "--status",
    "success",
    "--limit",
    "1",
    "--json",
    "databaseId,conclusion,updatedAt",
  ]);
  const [latest] = JSON.parse(stdout) as NonNullable<BackupRun>[];
  if (!latest) return { run: null, artifacts: 0 };
  const artifacts = await run("gh", [
    "api",
    `repos/${BACKUP_REPO}/actions/runs/${latest.databaseId}/artifacts`,
    "--jq",
    "[.artifacts[] | select(.expired | not)] | length",
  ]);
  return { run: latest, artifacts: Number(artifacts.stdout.trim()) || 0 };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

export const CONFIRM_WORD = "importar";

export type Args = { ok: true; file: string; dryRun: boolean } | { ok: false; message: string };

const USAGE = "Usage: pnpm db:finance:import <file.json> [--dry-run]";

export function parseArgs(argv: readonly string[]): Args {
  const dryRun = argv.includes("--dry-run");
  const rest = argv.filter((arg) => arg !== "--dry-run");
  if (rest.length !== 1 || rest[0].startsWith("-")) return { ok: false, message: USAGE };
  return { ok: true, file: rest[0], dryRun };
}

export type Gate =
  { ok: true; askHost: boolean; checkBackup: boolean } | { ok: false; message: string };

/**
 * What a run must confirm, before any query. A dry run only reads: no prompts. A real import on a
 * remote database checks the backup and asks for the host and CONFIRM_WORD (so it needs a
 * terminal); locally (the test database) it runs without prompts. ALLOW_PROD_DB is checked
 * before this (`resolveOwnerScriptDatabaseUrl`).
 */
export function gate(dryRun: boolean, isLocal: boolean, isTTY: boolean): Gate {
  if (dryRun || isLocal) return { ok: true, askHost: false, checkBackup: false };
  if (!isTTY) {
    return {
      ok: false,
      message: "Run this in an interactive terminal: the confirmation is typed.",
    };
  }
  return { ok: true, askHost: true, checkBackup: true };
}

/** Reads and validates the file. Throws FinanceImportError (paths and messages only). */
export async function loadImportFile(path: string): Promise<ImportFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new FinanceImportError(`Could not read ${path} as JSON.`);
  }
  const parsed = importFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FinanceImportError(`The file is not valid:\n${describeFileIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function formatReport(report: ImportReport): string {
  const verb = report.dryRun ? "would insert" : "inserted";
  const counts = (label: string, c: Counts) =>
    `  ${label}: ${verb} ${c.inserted}, already there (left as they are) ${c.skipped}`;
  const lines = [
    `${report.dryRun ? "Plan (dry run, nothing written)" : "Imported"} for ${report.today} (Lima), Notion export of ${report.exportedAt}:`,
    counts("categories", report.categories),
    counts("payment methods", report.methods),
    counts("recurring payments", report.recurring),
    `  in the file: ${report.recurring.active} active, ${report.recurring.archived} archived, ${report.recurring.variable} variable`,
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
    const plan = await importFinance(db, file, new Date(), { dryRun: true });
    console.log(formatReport(plan));
    if (args.dryRun) return;

    if (check.checkBackup) {
      const latest = await readLatestBackup().catch(() => {
        throw new FinanceImportError("Could not read the backups with `gh` (is it logged in?).");
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
    console.log(formatReport(await importFinance(db, file, new Date(), { dryRun: false })));
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
      error instanceof FinanceImportError ||
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
