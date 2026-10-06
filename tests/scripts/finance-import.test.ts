// @vitest-environment node
// The pure parts of `pnpm db:finance:import`: the file schema, the mapping plan, the ids, the
// arguments, the remote-host guard, the prompts gate and the backup check.
import { describe, expect, test } from "vitest";
import { resolveOwnerScriptDatabaseUrl } from "@/lib/db-config";
import {
  assessBackup,
  BACKUP_MAX_AGE_HOURS,
  firstDueFrom,
  formatReport,
  gate,
  importCategoryId,
  importFileSchema,
  importMethodId,
  importRecurringId,
  parseArgs,
  planImport,
} from "../../scripts/finance-import";

const N1 = "11111111111111111111111111111111";
const N2 = "22222222-2222-2222-2222-222222222222";

function valid() {
  return {
    source: "notion",
    exportedAt: "2026-10-05T12:00:00-05:00",
    categories: [{ notionId: N1, name: "  Servicios  " }],
    paymentMethods: [
      { name: "Tarjeta X", currency: "PEN" },
      { name: "Débito dólares", currency: "USD" },
    ],
    recurring: [
      {
        notionId: N2,
        name: "Servicio A",
        amount: 49.9,
        dayOfMonth: 15,
        active: true,
        paymentMethod: "Tarjeta X",
        category: N1,
      },
    ],
  };
}

type Mutable = ReturnType<typeof valid> & Record<string, unknown>;

function issues(mutate: (file: Mutable) => void): string[] {
  const file = valid() as Mutable;
  mutate(file);
  const result = importFileSchema.safeParse(file);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("file schema", () => {
  test("a valid file parses and names are normalized", () => {
    const file = importFileSchema.parse(valid());
    expect(file.categories[0].name).toBe("Servicios");
    expect(issues(() => {})).toEqual([]);
    expect(issues((f) => (f.exportedAt = "2026-10-05"))).toEqual([]);
    expect(issues((f) => (f.recurring[0].amount = null as never))).toEqual([]);
  });

  test("refuses unknown keys, another source and a bad Notion id", () => {
    expect(issues((f) => (f.extra = 1))).toEqual([""]);
    expect(issues((f) => (f.source = "excel"))).toEqual(["source"]);
    expect(issues((f) => (f.categories[0].notionId = "abc"))).toEqual(["categories.0.notionId"]);
  });

  test("amounts: > 0, ≤ 1 000 000, at most 2 decimals", () => {
    for (const bad of [0, -5, 12.345, 1_000_000.01, 0.1 + 0.2]) {
      expect(issues((f) => (f.recurring[0].amount = bad))).toEqual(["recurring.0.amount"]);
    }
    for (const ok of [0.01, 12, 12.5, 1_000_000]) {
      expect(issues((f) => (f.recurring[0].amount = ok))).toEqual([]);
    }
  });

  test("day of month 1–31, currency PEN or USD, names within limits", () => {
    expect(issues((f) => (f.recurring[0].dayOfMonth = 0))).toEqual(["recurring.0.dayOfMonth"]);
    expect(issues((f) => (f.recurring[0].dayOfMonth = 32))).toEqual(["recurring.0.dayOfMonth"]);
    expect(issues((f) => (f.recurring[0].dayOfMonth = 1.5))).toEqual(["recurring.0.dayOfMonth"]);
    expect(issues((f) => (f.paymentMethods[0].currency = "EUR"))).toEqual([
      "paymentMethods.0.currency",
    ]);
    expect(issues((f) => (f.categories[0].name = "x".repeat(41)))).toEqual(["categories.0.name"]);
    expect(issues((f) => (f.categories[0].name = "   "))).toEqual(["categories.0.name"]);
    expect(issues((f) => (f.recurring[0].name = "x".repeat(81)))).toEqual(["recurring.0.name"]);
  });

  test("repeated ids and names (any case, dashes ignored) are refused", () => {
    expect(issues((f) => f.categories.push({ notionId: N1.toUpperCase(), name: "Otra" }))).toEqual([
      "categories.1",
    ]);
    expect(issues((f) => f.categories.push({ notionId: N2, name: "SERVICIOS" }))).toEqual([
      "categories.1",
    ]);
    expect(issues((f) => f.paymentMethods.push({ name: "tarjeta  x", currency: "USD" }))).toEqual([
      "paymentMethods.2",
    ]);
    expect(
      issues((f) => f.recurring.push({ ...f.recurring[0], notionId: N2.replace(/-/g, "") })),
    ).toEqual(["recurring.1"]);
  });
});

describe("ids", () => {
  test("deterministic, by Notion id (any form) or by method name (any case)", () => {
    expect(importCategoryId(N2)).toBe(importCategoryId(N2.replace(/-/g, "").toUpperCase()));
    expect(importMethodId(" Débito  DÓLARES ")).toBe(importMethodId("débito dólares"));
    // Same Notion id, different kinds: different rows.
    expect(importCategoryId(N1)).not.toBe(importRecurringId(N1));
    expect(importCategoryId(N1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab]/);
  });
});

describe("plan", () => {
  test("next due date from the import day, clamped to the month's end", () => {
    expect(firstDueFrom(31, "2026-02-27")).toBe("2026-02-28");
    expect(firstDueFrom(31, "2026-02-28")).toBe("2026-02-28"); // due today
    expect(firstDueFrom(31, "2026-04-30")).toBe("2026-04-30");
    expect(firstDueFrom(29, "2028-02-15")).toBe("2028-02-29"); // leap year
    expect(firstDueFrom(5, "2026-10-05")).toBe("2026-10-05");
    expect(firstDueFrom(4, "2026-10-05")).toBe("2026-11-04");
    expect(firstDueFrom(1, "2026-12-31")).toBe("2027-01-01");
  });

  test("maps cents, refs and warnings (USD-looking PEN method, unknown refs)", () => {
    const file = importFileSchema.parse({
      ...valid(),
      paymentMethods: [{ name: "Tarjeta USD", currency: "PEN" }],
      recurring: [
        { ...valid().recurring[0], paymentMethod: "Tarjeta X", category: N2 },
        { ...valid().recurring[0], notionId: N1, amount: null, active: false },
      ],
    });
    const plan = planImport(file, "2026-10-05");
    expect(plan.recurring[0]).toMatchObject({
      amountCents: 4990,
      startDate: "2026-10-15",
      categoryId: null,
      paymentMethodId: null,
      active: true,
    });
    expect(plan.recurring[1]).toMatchObject({ amountCents: null, active: false });
    expect(plan.warnings).toEqual([
      'Method "Tarjeta USD" looks like USD but the file says PEN (kept PEN).',
      `"Servicio A": unknown category ${N2} (left without one).`,
      '"Servicio A": unknown payment method "Tarjeta X" (left without one).',
      '"Servicio A": unknown payment method "Tarjeta X" (left without one).',
    ]);
  });

  test("the summary never prints amounts", () => {
    const text = formatReport({
      dryRun: true,
      today: "2026-10-05",
      categories: { inserted: 1, skipped: 0 },
      methods: { inserted: 2, skipped: 0 },
      recurring: { inserted: 1, skipped: 0, active: 1, archived: 0, variable: 0 },
      warnings: [],
    });
    expect(text).toContain("would insert");
    expect(text).not.toMatch(/49|4990/);
  });
});

describe("CLI guards", () => {
  const REMOTE = "postgresql://owner:secret@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=require";

  test("a remote host needs ALLOW_PROD_DB=1 (the URL never in the message)", () => {
    expect(() => resolveOwnerScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE })).toThrow(
      /Refusing/,
    );
    try {
      resolveOwnerScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE });
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
    expect(
      resolveOwnerScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE, ALLOW_PROD_DB: "1" }),
    ).toBe(REMOTE);
    // VERCEL=1 is not permission.
    expect(() =>
      resolveOwnerScriptDatabaseUrl({ DATABASE_URL_UNPOOLED: REMOTE, VERCEL: "1" }),
    ).toThrow(/Refusing/);
  });

  test("arguments: one file, optional --dry-run", () => {
    expect(parseArgs(["a.json"])).toEqual({ ok: true, file: "a.json", dryRun: false });
    expect(parseArgs(["--dry-run", "a.json"])).toEqual({ ok: true, file: "a.json", dryRun: true });
    expect(parseArgs([]).ok).toBe(false);
    expect(parseArgs(["a.json", "b.json"]).ok).toBe(false);
    expect(parseArgs(["--force"]).ok).toBe(false);
  });

  test("gate: a remote import checks the backup and asks (needs a terminal); dry runs and local don't", () => {
    expect(gate(false, false, true)).toEqual({ ok: true, askHost: true, checkBackup: true });
    expect(gate(false, false, false).ok).toBe(false);
    expect(gate(true, false, false)).toEqual({ ok: true, askHost: false, checkBackup: false });
    expect(gate(false, true, false)).toEqual({ ok: true, askHost: false, checkBackup: false });
  });

  test("backup: a recent success with its artifact passes; old, missing or empty fail", () => {
    const now = new Date("2026-10-05T15:00:00Z");
    const recent = { databaseId: 7, conclusion: "success", updatedAt: "2026-10-05T14:30:00Z" };
    expect(assessBackup(recent, 1, now)).toEqual({ ok: true, runId: 7 });
    expect(assessBackup(null, 0, now).ok).toBe(false);
    expect(assessBackup({ ...recent, conclusion: "failure" }, 1, now).ok).toBe(false);
    expect(assessBackup(recent, 0, now).ok).toBe(false);
    const old = new Date(now.getTime() - (BACKUP_MAX_AGE_HOURS * 3_600_000 + 60_000));
    expect(assessBackup({ ...recent, updatedAt: old.toISOString() }, 1, now).ok).toBe(false);
    // A clock skew into the future is not "recent".
    expect(assessBackup({ ...recent, updatedAt: "2026-10-05T16:00:00Z" }, 1, now).ok).toBe(false);
  });
});
