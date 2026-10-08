// reminders → settings-input.ts (R2): the Zod schema of Ajustes → Avisos' writes.
import { describe, expect, test } from "vitest";
import {
  DEFAULT_SCHEDULE,
  scheduleOf,
  SETTINGS_ERRORS,
  updateReminderSettingsSchema,
} from "@/modules/reminders/settings-input";

const parse = (input: unknown) => updateReminderSettingsSchema.safeParse(input);

describe("updateReminderSettingsSchema", () => {
  test("accepts one field or several", () => {
    expect(parse({ briefingEnabled: false }).success).toBe(true);
    expect(parse({ briefingTime: "08:00", eveningTime: "21:30" }).success).toBe(true);
    expect(
      parse({
        briefingEnabled: true,
        briefingTime: "07:30",
        paymentsEnabled: false,
        eveningEnabled: true,
        eveningTime: "00:00",
        habitTimesEnabled: false,
        showAmountsTelegram: false,
      }).success,
    ).toBe(true);
  });

  test("times are HH:MM, 24 h, without seconds", () => {
    for (const good of ["00:00", "07:30", "19:05", "23:59"]) {
      expect(parse({ briefingTime: good }).success, good).toBe(true);
    }
    for (const bad of [
      "7:30",
      "07:30:00",
      "24:00",
      "12:60",
      "07-30",
      "",
      "ocho",
      "07:3",
      " 07:30",
    ]) {
      const result = parse({ briefingTime: bad });
      expect(result.success, bad).toBe(false);
    }
    const result = parse({ eveningTime: "25:00" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(SETTINGS_ERRORS.timeInvalid);
    }
  });

  test("switches are booleans, not strings or numbers", () => {
    expect(parse({ briefingEnabled: "true" }).success).toBe(false);
    expect(parse({ paymentsEnabled: 1 }).success).toBe(false);
    expect(parse({ showAmountsTelegram: null }).success).toBe(false);
    expect(parse({ habitTimesEnabled: "false" }).success).toBe(false);
    expect(parse({ habitTimesEnabled: 0 }).success).toBe(false);
  });

  test("an empty change, or one of undefined values, is refused", () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ briefingTime: undefined }).success).toBe(false);
  });

  test("fields the owner does not edit here are rejected, not ignored", () => {
    for (const key of ["telegramChatId", "deliveryChannel", "showAmountsPush", "id"]) {
      expect(parse({ briefingEnabled: true, [key]: key === "id" ? false : "x" }).success, key).toBe(
        false,
      );
    }
  });
});

describe("scheduleOf", () => {
  test("drops the seconds Postgres' time adds", () => {
    expect(
      scheduleOf({
        briefingEnabled: false,
        briefingTime: "08:15:00",
        paymentsEnabled: true,
        eveningEnabled: false,
        eveningTime: "22:00:00",
        habitTimesEnabled: false,
        showAmountsTelegram: false,
      }),
    ).toEqual({
      briefingEnabled: false,
      briefingTime: "08:15",
      paymentsEnabled: true,
      eveningEnabled: false,
      eveningTime: "22:00",
      habitTimesEnabled: false,
      showAmountsTelegram: false,
    });
  });

  test("a fresh install has the spec's defaults: briefing 07:30, review 21:00", () => {
    expect(DEFAULT_SCHEDULE).toMatchObject({ briefingTime: "07:30", eveningTime: "21:00" });
    expect(DEFAULT_SCHEDULE.briefingEnabled).toBe(true);
    expect(DEFAULT_SCHEDULE.showAmountsTelegram).toBe(true);
    // The habits' own times are on by default, like the column.
    expect(DEFAULT_SCHEDULE.habitTimesEnabled).toBe(true);
  });
});
