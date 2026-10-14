// `db:household:import`: the file's schema and the pure plan (SPEC-household «Alcance»: only the
// cleaning is imported). The writes are tested against Postgres (tests/integration/household-import.test.ts).
import { describe, expect, test } from "vitest";
import {
  FREQUENCY_BY_NOTION,
  importCleaningId,
  importFileSchema,
  parseArgs,
  planImport,
  type ImportFile,
} from "../../scripts/household-import";

const ID = (n: number) => `${String(n).padStart(32, "0")}`;
const row = (n: number, patch: Partial<ImportFile["cleanings"][number]> = {}) => ({
  notionId: ID(n),
  title: `Limpieza ${n}`,
  zone: "Baño",
  frequency: "Diario" as const,
  weekday: null,
  nextDate: null,
  completed: false,
  ...patch,
});
const file = (cleanings: ReturnType<typeof row>[]) => ({
  source: "notion" as const,
  exportedAt: "2026-10-14T12:00:00-05:00",
  cleanings,
});
const parse = (cleanings: ReturnType<typeof row>[]) => importFileSchema.parse(file(cleanings));

/** Wednesday 2026-10-14 (Lima). */
const TODAY = "2026-10-14";

describe("the file", () => {
  test("a valid file is accepted; dashes in a Notion id and accents in the weekday are fine", () => {
    const parsed = parse([
      row(1, {
        notionId: "00000000-0000-0000-0000-000000000001",
        frequency: "Semanal",
        weekday: "Miércoles",
      }),
      row(2, { zone: null, frequency: "Trimestral" }),
    ]);
    expect(parsed.cleanings).toHaveLength(2);
    expect(importCleaningId("00000000-0000-0000-0000-000000000001")).toBe(importCleaningId(ID(1)));
  });

  test.each([
    ["an unknown key", { ...file([row(1)]), extra: 1 }],
    ["another source", { ...file([row(1)]), source: "csv" }],
    ["a repeated Notion id", file([row(1), row(1, { title: "Otra" })])],
    ["a bad Notion id", file([row(1, { notionId: "xyz" })])],
    ["an unknown frequency", file([row(1, { frequency: "Anual" as never })])],
    ["an unknown weekday", file([row(1, { weekday: "Lunesday" })])],
    ["an empty title", file([row(1, { title: "   " })])],
    ["a title of 201 characters", file([row(1, { title: "x".repeat(201) })])],
    ["a zone of 25 characters", file([row(1, { zone: "x".repeat(25) })])],
    ["a zone with a comma", file([row(1, { zone: "a, b" })])],
    ["a bad date", file([row(1, { nextDate: "2026-02-30" })])],
  ])("refuses %s", (_, bad) => {
    expect(importFileSchema.safeParse(bad).success).toBe(false);
  });

  test("the Notion options map to the five frequencies", () => {
    expect(FREQUENCY_BY_NOTION).toEqual({
      Diario: "daily",
      Semanal: "weekly",
      Quincenal: "biweekly",
      Mensual: "monthly",
      Trimestral: "quarterly",
    });
  });

  test("the arguments", () => {
    expect(parseArgs(["a.json"])).toEqual({ ok: true, file: "a.json", dryRun: false });
    expect(parseArgs(["a.json", "--dry-run"])).toEqual({ ok: true, file: "a.json", dryRun: true });
    expect(parseArgs([]).ok).toBe(false);
    expect(parseArgs(["a.json", "b.json"]).ok).toBe(false);
    expect(parseArgs(["--x"]).ok).toBe(false);
  });
});

describe("the plan", () => {
  test("each frequency becomes the rule of the «Añadir limpieza» form", () => {
    const plan = planImport(
      parse([
        row(1, { frequency: "Diario" }),
        row(2, { frequency: "Quincenal" }),
        row(3, { frequency: "Mensual" }),
        row(4, { frequency: "Trimestral" }),
        row(5, { frequency: "Semanal", weekday: "Lunes" }),
      ]),
      TODAY,
    );
    expect(plan.cleanings.map((c) => c.recurrence)).toEqual([
      { kind: "every_days", interval: 1, weekdays: null, monthDay: null },
      { kind: "every_weeks", interval: 2, weekdays: null, monthDay: null },
      { kind: "every_months", interval: 1, weekdays: null, monthDay: null },
      { kind: "every_months", interval: 3, weekdays: null, monthDay: null },
      { kind: "weekdays", interval: null, weekdays: [1], monthDay: null },
    ]);
  });

  test("the tags are the cleaning tag and the zone's, with the app's accent in the kitchen", () => {
    const plan = planImport(
      parse([
        row(1, { zone: "Cocina/Lavanderia" }),
        row(2, { zone: "Dormitorio principal" }),
        row(3, { zone: null }),
      ]),
      TODAY,
    );
    expect(plan.cleanings.map((c) => c.tags)).toEqual([
      ["limpieza", "zona: cocina/lavandería"],
      ["limpieza", "zona: dormitorio principal"],
      ["limpieza"],
    ]);
  });

  test("a future date is kept; a past or missing one starts on the first day that fits", () => {
    const plan = planImport(
      parse([
        row(1, { nextDate: "2026-10-20" }),
        row(2, { nextDate: "2026-10-01" }),
        row(3, { nextDate: null }),
        row(4, { nextDate: TODAY }),
      ]),
      TODAY,
    );
    expect(plan.cleanings.map((c) => c.dueDate)).toEqual(["2026-10-20", TODAY, TODAY, TODAY]);
    expect(plan.warnings.some((w) => w.startsWith("1 con «Próxima vez» ya pasada"))).toBe(true);
  });

  test("a weekly one lands on its weekday: the named one, else the date's, else today's (with a warning)", () => {
    const plan = planImport(
      parse([
        row(1, { frequency: "Semanal", weekday: "Sabado" }), // Saturday, from Wednesday
        row(2, { frequency: "Semanal", weekday: null, nextDate: "2026-10-21" }), // a Wednesday ahead
        row(3, { frequency: "Semanal", weekday: null, nextDate: null }),
        row(4, { frequency: "Semanal", weekday: "Lunes", nextDate: "2026-10-21" }), // date off its weekday
      ]),
      TODAY,
    );
    expect(plan.cleanings.map((c) => [c.recurrence.weekdays, c.dueDate])).toEqual([
      [[6], "2026-10-17"],
      [[3], "2026-10-21"],
      [[3], TODAY],
      [[1], "2026-10-19"],
    ]);
    expect(plan.warnings.filter((w) => w.includes("Semanal sin día ni fecha"))).toHaveLength(1);
  });

  test("completed rows are imported pending and counted", () => {
    const plan = planImport(
      parse([row(1, { completed: true }), row(2, { completed: true }), row(3)]),
      TODAY,
    );
    expect(plan.cleanings).toHaveLength(3);
    expect(plan.warnings).toContain("2 marcadas «Completado» en Notion: se importan pendientes.");
  });

  test("ids come from the Notion id, so a second run finds them again", () => {
    const a = planImport(parse([row(7)]), TODAY).cleanings[0].id;
    const b = planImport(parse([row(7)]), "2026-11-01").cleanings[0].id;
    expect(a).toBe(b);
    expect(a).not.toBe(planImport(parse([row(8)]), TODAY).cleanings[0].id);
  });
});
