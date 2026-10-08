// evening-close-ritual: the pure parts. The hour of the close in Lima, the wait until it, what
// the close says for a tally, and the copy (calm: no guilt, no "late", nothing urgent).
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  closeQuestion,
  EVENING_CLOSE_HOUR,
  eveningClose,
  isEveningClose,
  msUntilEveningClose,
} from "@/modules/today/evening-close";
import type { DayTally } from "@/modules/today/today-board";
import { TODAY_COPY } from "@/modules/today/today-copy";

const read = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bo_e2e_evening" && read.cookie !== undefined ? { value: read.cookie } : undefined,
  }),
}));

/** A Lima time (UTC−5, no daylight saving) as the instant it is. */
const lima = (time: string) => new Date(`2026-10-02T${time}-05:00`);

const tally = (values: {
  done?: number;
  total?: number;
  active?: number;
  pending?: number;
  doneToday?: number;
  blocking?: number;
}): DayTally => ({
  habits: {
    done: values.done ?? 0,
    total: values.total ?? 0,
    active: values.active ?? values.done ?? 0,
  },
  tasks: { pending: values.pending ?? 0, doneToday: values.doneToday ?? 0 },
  payments: { blocking: values.blocking ?? 0 },
});

describe("the hour of the close", () => {
  test("starts at 20:00 Lima, sharp", () => {
    expect(EVENING_CLOSE_HOUR).toBe(20);
    expect(isEveningClose(lima("19:59:59"))).toBe(false);
    expect(isEveningClose(lima("20:00:00"))).toBe(true);
    expect(isEveningClose(lima("23:59:59"))).toBe(true);
  });

  test("not in the morning or the afternoon, and Lima's hour rules, not the server's (UTC)", () => {
    expect(isEveningClose(lima("00:30:00"))).toBe(false);
    expect(isEveningClose(lima("12:00:00"))).toBe(false);
    // 20:30 in Lima is 01:30 UTC of the next day.
    expect(isEveningClose(new Date("2026-10-03T01:30:00Z"))).toBe(true);
    // 15:00 UTC is 10:00 in Lima.
    expect(isEveningClose(new Date("2026-10-02T15:00:00Z"))).toBe(false);
  });
});

describe("the wait until 20:00", () => {
  test("counts to the mark plus one second", () => {
    expect(msUntilEveningClose(lima("19:59:30"))).toBe(31_000);
    expect(msUntilEveningClose(lima("19:00:00"))).toBe(3_601_000);
    expect(msUntilEveningClose(lima("10:15:20"))).toBe((9 * 3600 + 44 * 60 + 40) * 1000 + 1000);
  });

  test("at or past the hour there is nothing to wait for", () => {
    expect(msUntilEveningClose(lima("20:00:00"))).toBeNull();
    expect(msUntilEveningClose(lima("22:10:00"))).toBeNull();
  });

  test("from the small hours it waits for the same evening", () => {
    expect(msUntilEveningClose(lima("00:00:00"))).toBe(20 * 3600 * 1000 + 1000);
  });

  test("the wait always fits a timer (< 2^31 ms) and is positive", () => {
    const bad: string[] = [];
    for (let minute = 0; minute < 20 * 60; minute += 7) {
      const hh = String(Math.floor(minute / 60)).padStart(2, "0");
      const mm = String(minute % 60).padStart(2, "0");
      const wait = msUntilEveningClose(lima(`${hh}:${mm}:13`));
      if (wait === null || wait <= 0 || wait >= 2 ** 31) bad.push(`${hh}:${mm}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("what the close says", () => {
  test("achieved, habits left and tasks left", () => {
    expect(eveningClose(tally({ done: 4, total: 5, pending: 2, doneToday: 3 }))).toEqual({
      habits: 4,
      tasks: 3,
      habitsOpen: { done: 4, total: 5 },
      pending: 2,
    });
  });

  test("all habits done: no 'X de N'", () => {
    expect(eveningClose(tally({ done: 3, total: 3, pending: 1 }))?.habitsOpen).toBeNull();
  });

  test("a finished day is 'Día completo''s, not the close", () => {
    expect(eveningClose(tally({ done: 3, total: 3, doneToday: 1 }))).toBeNull();
  });

  test("nothing done and nothing to move: nothing to say (even with habits left)", () => {
    expect(eveningClose(tally({ done: 0, total: 3 }))).toBeNull();
    expect(eveningClose(tally({}))).toBeNull();
  });

  test("only tasks to move, nothing done yet: the question still has its place", () => {
    expect(eveningClose(tally({ pending: 2 }))?.pending).toBe(2);
  });

  test("a payment that is due keeps the day open but is not the close's to move", () => {
    const close = eveningClose(tally({ done: 1, total: 1, doneToday: 0, blocking: 1 }));
    expect(close).not.toBeNull();
    expect(close?.pending).toBe(0);
  });
});

describe("the question", () => {
  const days = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];

  test("is stable all day and varies across days", () => {
    for (const day of days) expect(closeQuestion(day, 3)).toBe(closeQuestion(day, 3));
    expect(new Set(days.map((day) => closeQuestion(day, 3))).size).toBeGreaterThan(1);
  });

  test("has 3 or more variants, each in the singular and the plural", () => {
    const questions = TODAY_COPY.eveningClose.questions;
    expect(questions.length).toBeGreaterThanOrEqual(3);
    for (const question of questions) {
      expect(question(1)).toMatch(/\b(1|una|esa) tarea\b|La pasamos|La movemos/i);
      expect(question(1)).not.toMatch(/tareas/);
      expect(question(4)).toMatch(/4 tareas|esas 4 tareas/);
    }
  });

  test("always ends by offering tomorrow, with the count of the board", () => {
    for (const question of TODAY_COPY.eveningClose.questions) {
      expect(question(2)).toMatch(/mañana/i);
      expect(question(2)).toContain("2");
    }
  });

  // The question may say "Quedan 2 tareas" (the owner asked for it); the rest of the pressure
  // words stay out. A positive control proves the check can fail.
  const PRESSURE = [
    /atrasad/i,
    /vencid/i,
    /urgente/i,
    /fallaste/i,
    /perdiste/i,
    /deber[ií]as/i,
    /\bdebes\b/i,
    /culpa/i,
    /olvidaste/i,
    /ap[uú]rate/i,
    /ya es tarde/i,
    /todav[ií]a/i,
    /no (hiciste|has)\b/i,
    /pendiente/i,
  ];
  const pressure = (text: string) => PRESSURE.filter((pattern) => pattern.test(text));

  test("every variant is clear of pressure words", () => {
    const hits = TODAY_COPY.eveningClose.questions
      .flatMap((question) => [1, 2, 9].map((count) => question(count)))
      .filter((text) => pressure(text).length > 0);
    expect(hits).toEqual([]);
  });

  test("positive control: a variant with pressure does fail the check", () => {
    for (const bad of [
      "Ya es tarde: 3 tareas atrasadas.",
      "Todavía te quedan tareas.",
      "Debes moverlas.",
    ]) {
      expect(pressure(bad).length, bad).toBeGreaterThan(0);
    }
    expect(pressure("Quedan 2 tareas. ¿Las pasamos a mañana?")).toEqual([]);
  });
});

describe("the page's decision (isEveningCloseFor)", () => {
  async function decide(now: Date, env: Record<string, string | undefined>, cookie?: string) {
    read.cookie = cookie;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) vi.stubEnv(key, "");
      else vi.stubEnv(key, value);
    }
    vi.resetModules();
    const { isEveningCloseFor } = await import("@/modules/today/evening-close-server");
    return isEveningCloseFor(now);
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("in production the hour decides, and a cookie is ignored", async () => {
    expect(await decide(lima("21:00:00"), { E2E_ERROR_ROUTES: "" }, "off")).toBe(true);
    expect(await decide(lima("10:00:00"), { E2E_ERROR_ROUTES: "" }, "on")).toBe(false);
  });

  test("in an E2E build only the cookie decides, whatever the hour", async () => {
    expect(await decide(lima("21:00:00"), { E2E_ERROR_ROUTES: "1", VERCEL: "" })).toBe(false);
    expect(await decide(lima("21:00:00"), { E2E_ERROR_ROUTES: "1", VERCEL: "" }, "off")).toBe(
      false,
    );
    expect(await decide(lima("10:00:00"), { E2E_ERROR_ROUTES: "1", VERCEL: "" }, "on")).toBe(true);
  });

  test("on Vercel the E2E flag never counts", async () => {
    expect(await decide(lima("10:00:00"), { E2E_ERROR_ROUTES: "1", VERCEL: "1" }, "on")).toBe(
      false,
    );
  });
});
