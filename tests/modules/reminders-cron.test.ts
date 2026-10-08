// @vitest-environment node
// reminders → the daily Vercel cron (vercel.json) is the safety net of the morning briefing. On
// the Hobby plan Vercel only guarantees the HOUR of a cron (it may fire at any minute of it), so
// the whole hour must fall inside the default briefing's window, or the safety net could land
// after the 2 h grace and the briefing would be skipped.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_BRIEFING_TIME } from "@/modules/reminders/reminders-constants";
import { limaInstant, windowState } from "@/modules/reminders/slots";

const ROOT = process.cwd();
const config = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
  buildCommand?: string;
  git?: { deploymentEnabled?: boolean };
  crons?: { path: string; schedule: string }[];
};

const tickCron = config.crons?.find((cron) => cron.path === "/api/reminders/tick");

describe("vercel.json", () => {
  test("keeps the build command and the disabled Git auto-deploy", () => {
    expect(config.buildCommand).toBe("bash scripts/vercel-build.sh");
    expect(config.git?.deploymentEnabled).toBe(false);
  });

  test("has a cron for the tick endpoint, and that route exists", () => {
    expect(tickCron).toBeDefined();
    expect(existsSync(path.join(ROOT, "src/app/api/reminders/tick/route.ts"))).toBe(true);
  });

  test("is a daily cron at a fixed hour: `<minute> <hour> * * *`", () => {
    expect(tickCron?.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  test("every minute of its hour falls inside the default briefing's window", () => {
    const [minute, hour] = tickCron!.schedule.split(" ").map(Number);
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThan(24);
    // Cron runs in UTC. Any day works: Lima has no daylight saving. Hobby: the whole hour.
    const day = "2026-10-08";
    const hourStart = Date.UTC(2026, 9, 8, hour, 0);
    const briefingDue = limaInstant(day, DEFAULT_BRIEFING_TIME);
    const states = new Set<string>();
    for (let offset = 0; offset < 60; offset++) {
      states.add(windowState(briefingDue, new Date(hourStart + offset * 60_000)));
    }
    expect([...states]).toEqual(["open"]);
    // The configured minute is inside that hour (positive control of the parsing).
    expect(minute).toBeGreaterThanOrEqual(0);
    expect(minute).toBeLessThan(60);
  });

  test("the check can fail: 12:30 UTC (the first choice) would not be guaranteed", () => {
    // Hour 12 starts at 07:00 in Lima, before the briefing is due (07:30): early for half of it.
    const briefingDue = limaInstant("2026-10-08", DEFAULT_BRIEFING_TIME);
    expect(windowState(briefingDue, new Date(Date.UTC(2026, 9, 8, 12, 0)))).toBe("early");
  });
});
