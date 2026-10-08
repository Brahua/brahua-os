// greeting-variants (corte `polish`): the line under the greeting of "/". Pure selection by part
// of the Lima day and state, stable within a day, and the blacklist of pressure words over EVERY
// variant (with a positive control so the check itself can fail).
import { describe, expect, test } from "vitest";
import { dayPartFor } from "@/lib/time";
import {
  dayState,
  greetingLine,
  greetingPool,
  isMonday,
  openThings,
  type DayState,
  type GreetingVariant,
} from "@/modules/today/greeting";
import type { DayTally } from "@/modules/today/today-board";
import { TODAY_COPY } from "@/modules/today/today-copy";

// Lima is UTC-5 all year.
const lima = (isoLocal: string) => new Date(`${isoLocal}-05:00`);

const tally = (values: {
  habits?: Partial<DayTally["habits"]>;
  tasks?: Partial<DayTally["tasks"]>;
  blocking?: number;
}): DayTally => ({
  habits: { done: 0, total: 0, active: 0, ...values.habits },
  tasks: { pending: 0, doneToday: 0, ...values.tasks },
  payments: { blocking: values.blocking ?? 0 },
});

const NONE = tally({ habits: { total: 2 }, tasks: { pending: 1 } });
const SOME = tally({ habits: { total: 2, done: 1, active: 1 }, tasks: { pending: 1 } });
const ALL = tally({ habits: { total: 1, done: 1, active: 1 } });
const EMPTY = tally({});

// Friday 2026-10-02 and Monday 2026-10-05.
const FRIDAY = "2026-10-02";
const MONDAY = "2026-10-05";

describe("dayPartFor (Lima time)", () => {
  test.each([
    ["2026-10-02T00:00:00", "evening"],
    ["2026-10-02T04:59:59", "evening"],
    ["2026-10-02T06:00:00", "morning"],
    ["2026-10-02T11:59:00", "morning"],
    ["2026-10-02T12:00:00", "afternoon"],
    ["2026-10-02T18:59:00", "afternoon"],
    ["2026-10-02T19:00:00", "evening"],
    ["2026-10-02T23:59:00", "evening"],
  ])("%s → %s", (time, part) => {
    expect(dayPartFor(lima(time))).toBe(part);
  });

  test("uses Lima's hour, not UTC's (midnight in Lima is 05:00 UTC)", () => {
    expect(dayPartFor(new Date("2026-10-03T05:00:00Z"))).toBe("evening");
    expect(dayPartFor(new Date("2026-10-02T15:00:00Z"))).toBe("morning");
  });
});

describe("dayState", () => {
  test.each<[string, DayTally, DayState]>([
    ["nothing done", NONE, "none"],
    ["a habit done", SOME, "some"],
    ["a task completed today", tally({ tasks: { pending: 1, doneToday: 1 } }), "some"],
    ["everything done", ALL, "all"],
    ["no habits and no tasks", EMPTY, "empty"],
    ["only a payment due", tally({ blocking: 1 }), "none"],
    ["only avoid habits (no activity)", tally({ habits: { total: 1, done: 1 } }), "none"],
  ])("%s → %s", (_name, value, state) => {
    expect(dayState(value)).toBe(state);
  });

  test("openThings adds habits not met, tasks and payments due", () => {
    expect(openThings(SOME)).toBe(2);
    expect(openThings(tally({ habits: { total: 1, done: 1 }, blocking: 2 }))).toBe(2);
  });
});

describe("greetingLine", () => {
  test("is null for a finished or an empty day (their blocks already say it)", () => {
    for (const part of ["morning", "afternoon", "evening"] as const) {
      expect(greetingLine({ part, tally: ALL, today: FRIDAY })).toBeNull();
      expect(greetingLine({ part, tally: EMPTY, today: FRIDAY })).toBeNull();
    }
  });

  test.each([
    ["06:00", "morning", NONE],
    ["11:59", "morning", SOME],
    ["12:00", "afternoon", NONE],
    ["18:59", "afternoon", SOME],
    ["19:00", "evening", NONE],
    ["23:59", "evening", SOME],
    ["00:00", "evening", NONE],
  ] as const)("%s picks from the %s pool of its state", (_time, part, value) => {
    const line = greetingLine({ part, tally: value, today: FRIDAY });
    const count = openThings(value);
    const pool = greetingPool(part, dayState(value), { monday: false, count });
    const texts = pool.map((variant) => (typeof variant === "string" ? variant : variant(count)));
    expect(line).not.toBeNull();
    expect(texts).toContain(line);
  });

  test("the same part, state and day give the same line; days vary it", () => {
    const args = { part: "afternoon", tally: SOME } as const;
    expect(greetingLine({ ...args, today: FRIDAY })).toBe(greetingLine({ ...args, today: FRIDAY }));
    const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
    const lines = new Set(days.map((today) => greetingLine({ ...args, today })));
    expect(lines.size).toBeGreaterThan(1);
  });

  test("says how many things the morning holds (count variants need at least one)", () => {
    const days = Array.from({ length: 28 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
    const lines = days.map((today) => greetingLine({ part: "morning", tally: NONE, today }));
    expect(lines).toContain("Empieza por lo que importa: hay 3 cosas arriba.");
    // With nothing open there is no count to say.
    const pool = greetingPool("morning", "none", { monday: false, count: 0 });
    expect(pool.every((variant) => typeof variant === "string")).toBe(true);
    expect(pool.length).toBeGreaterThan(0);
    // Singular.
    const one = tally({ tasks: { pending: 1 } });
    const ones = days.map((today) => greetingLine({ part: "morning", tally: one, today }));
    expect(ones).toContain("Empieza por lo que importa: hay 1 cosa arriba.");
  });

  test("Mondays can open with a clean slate, only when nothing is done", () => {
    expect(isMonday(MONDAY)).toBe(true);
    expect(isMonday(FRIDAY)).toBe(false);
    const clean = TODAY_COPY.greetingLines.mondayNone;
    const none = greetingPool("morning", "none", { monday: true, count: 3 });
    expect(none).toEqual(expect.arrayContaining([...clean]));
    expect(greetingPool("morning", "none", { monday: false, count: 3 })).not.toContain(clean[0]);
    expect(greetingPool("morning", "some", { monday: true, count: 3 })).not.toContain(clean[0]);
    // Over a few months of Mondays the clean slate shows.
    const mondays = Array.from({ length: 20 }, (_, i) =>
      new Date(Date.UTC(2026, 9, 5 + i * 7)).toISOString().slice(0, 10),
    );
    const lines = mondays.map((today) => greetingLine({ part: "morning", tally: NONE, today }));
    expect(lines.some((line) => clean.some((text) => text === line))).toBe(true);
  });
});

// ── Blacklist ──

/** Words and shapes that read as pressure, guilt, debt or urgency (principles 7, 15). */
const FORBIDDEN: readonly RegExp[] = [
  /todav[ií]a/i,
  /\ba[uú]n\b/i,
  /\bs[oó]lo\b/i,
  /\bfaltas?\b/i,
  /\bfaltan\b/i,
  /\b(quedan?|restan?)\s+\d/i,
  /\d+\s+(que\s+)?(faltan|quedan|restan|pendientes)/i,
  /fallaste/i,
  /atrasad/i,
  /perdiste/i,
  /deber[ií]as/i,
  /\bdebes\b/i,
  /ya es tarde/i,
  /\bya (deber|es|pas)/i,
  /pendiente/i,
  /vencid/i,
  /urgente/i,
  /culpa/i,
  /olvidaste/i,
  /ap[uú]rate/i,
  /\bno (hiciste|has)\b/i,
];

const forbiddenIn = (text: string) => FORBIDDEN.filter((pattern) => pattern.test(text));

/** Every variant of the copy, function variants rendered for 1, 2 and 9 things. */
function allTexts(): string[] {
  const lines = TODAY_COPY.greetingLines;
  const variants: GreetingVariant[] = [
    ...Object.values(lines.none).flat(),
    ...Object.values(lines.some).flat(),
    ...lines.mondayNone,
  ];
  return variants.flatMap((variant) =>
    typeof variant === "string" ? [variant] : [1, 2, 9].map((count) => variant(count)),
  );
}

describe("blacklist of the line under the greeting", () => {
  test("every variant is clear of pressure words", () => {
    const hits = allTexts()
      .map((text) => ({ text, hits: forbiddenIn(text).map(String) }))
      .filter((entry) => entry.hits.length > 0);
    expect(hits).toEqual([]);
  });

  test("every combination has 3 or 4 variants", () => {
    const lines = TODAY_COPY.greetingLines;
    for (const group of [lines.none, lines.some]) {
      for (const variants of Object.values(group)) {
        expect(variants.length).toBeGreaterThanOrEqual(3);
        expect(variants.length).toBeLessThanOrEqual(4);
      }
    }
    expect(allTexts().length).toBeGreaterThan(20);
  });

  test("positive control: a variant with a forbidden word does fail the check", () => {
    for (const bad of [
      "Todavía puedes hacer algo.",
      "Sólo quedan 3 cosas.",
      "Te faltan 2 cosas.",
      "Fallaste ayer.",
      "Tareas atrasadas.",
      "Perdiste la racha.",
      "Ya deberías haber empezado.",
      "Ya es tarde para eso.",
    ]) {
      expect(forbiddenIn(bad).length, bad).toBeGreaterThan(0);
    }
    expect(forbiddenIn("Buen arranque. Sigue a tu ritmo.")).toEqual([]);
  });
});
