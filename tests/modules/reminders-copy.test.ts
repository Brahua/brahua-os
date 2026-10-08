// reminders → what the bot and Ajustes say never carries guilt (SPEC-reminders "Estrategia de
// pruebas": «racha», «riesgo», «⚠️», «atrasad», «deuda»). R2 extends this list with the reminders'
// own messages (messages.ts).
import { describe, expect, test } from "vitest";
import { BOT_MESSAGES } from "@/modules/reminders/channels/telegram/copy";
import * as remindersCopy from "@/modules/reminders/reminders-copy";

/** Words and signs a reminder never uses (lowercase; matched on the lowercase text). */
const FORBIDDEN = ["racha", "riesgo", "⚠️", "atrasad", "deuda", "vencid", "pierdes", "perdiste"];

function allStrings(): string[] {
  const strings: string[] = [...BOT_MESSAGES];
  for (const value of Object.values(remindersCopy)) {
    if (typeof value === "string") strings.push(value);
  }
  for (const state of ["disconnected", "connected", "blocked"] as const) {
    strings.push(remindersCopy.telegramStateText(state, "3 oct. 2026"));
    strings.push(remindersCopy.telegramStateText(state, null));
  }
  return strings;
}

describe("copy", () => {
  test("has something to check", () => {
    expect(allStrings().length).toBeGreaterThan(8);
  });

  test("no forbidden word or sign appears anywhere", () => {
    const found = allStrings().flatMap((text) =>
      FORBIDDEN.filter((word) => text.toLowerCase().includes(word)).map((word) => ({ text, word })),
    );
    expect(found).toEqual([]);
  });

  test("the bot's messages are short", () => {
    for (const text of BOT_MESSAGES) {
      expect(text.split("\n").length).toBeLessThanOrEqual(3);
      expect(text.length).toBeLessThanOrEqual(200);
    }
  });
});
