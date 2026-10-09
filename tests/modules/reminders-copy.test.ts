// reminders → what the bot and Ajustes say never carries guilt (SPEC-reminders "Estrategia de
// pruebas": «racha», «riesgo», «⚠️», «atrasad», «deuda»). R2 added the copy of Ajustes → Avisos
// del día; the reminders' own sentences (messages.ts) are checked in reminders-messages.test.ts.
import { describe, expect, test } from "vitest";
import {
  BOT_HELP_MESSAGE,
  BOT_MESSAGES,
  expenseCapturedReply,
  taskCapturedReply,
} from "@/modules/reminders/channels/telegram/copy";
import { DAYPART_LABELS, REMINDER_COPY, REMINDER_ERRORS } from "@/modules/habits/reminder-copy";
import * as remindersCopy from "@/modules/reminders/reminders-copy";
import { SETTINGS_ERRORS } from "@/modules/reminders/settings-input";

/** Words and signs a reminder never uses (lowercase; matched on the lowercase text). */
const FORBIDDEN = ["racha", "riesgo", "⚠️", "atrasad", "deuda", "vencid", "pierdes", "perdiste"];

/** Every string inside a value, however deep (the copy has nested objects). */
function flatten(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(flatten);
  return [];
}

function allStrings(): string[] {
  const strings: string[] = [...BOT_MESSAGES, BOT_HELP_MESSAGE, ...flatten(SETTINGS_ERRORS)];
  // R3: the capture replies are templates around the owner's own words.
  strings.push(taskCapturedReply("pilas", "vie 9 oct"), taskCapturedReply("pilas", null));
  strings.push(expenseCapturedReply("S/ 12.50", "café"), expenseCapturedReply("S/ 12.50", null));
  // R4: the habit form's reminder time and part-of-the-day copy lives in `habits`.
  strings.push(...flatten(REMINDER_ERRORS), ...flatten(DAYPART_LABELS));
  strings.push(...flatten(REMINDER_COPY), REMINDER_COPY.bandList("Mañana"));
  for (const value of Object.values(remindersCopy)) strings.push(...flatten(value));
  for (const state of ["disconnected", "connected", "blocked"] as const) {
    strings.push(remindersCopy.telegramStateText(state, "3 oct. 2026"));
    strings.push(remindersCopy.telegramStateText(state, null));
  }
  return strings;
}

describe("copy", () => {
  test("has something to check", () => {
    expect(allStrings().length).toBeGreaterThan(20);
  });

  test("the schedule's copy is part of what is checked", () => {
    expect(allStrings()).toContain(remindersCopy.SCHEDULE_COPY.briefing.label);
    expect(allStrings()).toContain(remindersCopy.SCHEDULE_COPY.amounts.help);
    // R4: the habits' times switch and the habit form's copy.
    expect(allStrings()).toContain(remindersCopy.SCHEDULE_COPY.habitTimes.help);
    expect(allStrings()).toContain(REMINDER_COPY.timeHelp);
  });

  test("no forbidden word or sign appears anywhere", () => {
    const found = allStrings().flatMap((text) =>
      FORBIDDEN.filter((word) => text.toLowerCase().includes(word)).map((word) => ({ text, word })),
    );
    expect(found).toEqual([]);
  });

  test("the help is the one long message, and still readable at a glance", () => {
    expect(BOT_HELP_MESSAGE.split("\n").length).toBeLessThanOrEqual(10);
    expect(BOT_HELP_MESSAGE.length).toBeLessThanOrEqual(500);
    for (const command of ["/tarea", "/gasto", "/hoy", "/ayuda"]) {
      expect(BOT_HELP_MESSAGE).toContain(command);
    }
  });

  test("a long text of the owner is cut when echoed back, never the whole thing", () => {
    const reply = taskCapturedReply("a".repeat(500), null);
    expect(reply.length).toBeLessThan(200);
    expect(reply.endsWith("…")).toBe(true);
    expect(taskCapturedReply("corto", null)).toBe("A la bandeja: corto");
  });

  test("the bot's messages are short", () => {
    for (const text of BOT_MESSAGES) {
      expect(text.split("\n").length).toBeLessThanOrEqual(3);
      expect(text.length).toBeLessThanOrEqual(200);
    }
  });
});
