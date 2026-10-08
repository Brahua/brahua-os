// reminders → policy.ts: which channels a reminder goes through (with the fallback to Telegram)
// and which kinds are switched on.
import { describe, expect, test } from "vitest";
import { isKindEnabled, selectChannels, showAmountsFor } from "@/modules/reminders/policy";
import { REMINDER_KINDS, type DeliveryChannel } from "@/modules/reminders/reminders-constants";

type Case = [DeliveryChannel, boolean, boolean, string[]];

// [delivery channel, has push devices, Telegram connected] → channels
const CASES: Case[] = [
  ["push", true, true, ["push"]],
  ["push", true, false, ["push"]],
  // The default is push, but with no device yet Telegram carries the reminders.
  ["push", false, true, ["telegram"]],
  ["push", false, false, []],
  ["telegram", true, true, ["telegram"]],
  ["telegram", false, true, ["telegram"]],
  ["telegram", true, false, []],
  ["telegram", false, false, []],
  ["both", true, true, ["push", "telegram"]],
  ["both", true, false, ["push"]],
  ["both", false, true, ["telegram"]],
  ["both", false, false, []],
];

describe("selectChannels", () => {
  test.each(CASES)(
    "%s, push devices %s, telegram %s → %j",
    (delivery, push, telegram, expected) => {
      expect(
        selectChannels({
          deliveryChannel: delivery,
          hasPushDevices: push,
          pushAvailable: true,
          telegramConnected: telegram,
        }),
      ).toEqual(expected);
    },
  );

  // Devices subscribed but push cannot send (no channel, VAPID keys missing): they don't count.
  test.each(CASES)(
    "%s, devices %s but push unavailable, telegram %s → as if there were no devices",
    (delivery, push, telegram) => {
      const without = selectChannels({
        deliveryChannel: delivery,
        hasPushDevices: false,
        pushAvailable: true,
        telegramConnected: telegram,
      });
      expect(
        selectChannels({
          deliveryChannel: delivery,
          hasPushDevices: push,
          pushAvailable: false,
          telegramConnected: telegram,
        }),
      ).toEqual(without);
    },
  );

  test("the fallback to Telegram works when push exists as a device but is not available", () => {
    expect(
      selectChannels({
        deliveryChannel: "push",
        hasPushDevices: true,
        pushAvailable: false,
        telegramConnected: true,
      }),
    ).toEqual(["telegram"]);
  });
});

describe("isKindEnabled", () => {
  const ALL_ON = {
    briefingEnabled: true,
    paymentsEnabled: true,
    eveningEnabled: true,
    habitTimesEnabled: true,
  };

  test("every kind follows its own switch", () => {
    const expected: Record<string, keyof typeof ALL_ON> = {
      briefing: "briefingEnabled",
      payment_eve: "paymentsEnabled",
      payment_followup: "paymentsEnabled",
      evening_review: "eveningEnabled",
      habit_time: "habitTimesEnabled",
    };
    for (const kind of REMINDER_KINDS) {
      expect(isKindEnabled(ALL_ON, kind)).toBe(true);
      const off = { ...ALL_ON, [expected[kind]]: false };
      expect(isKindEnabled(off, kind)).toBe(false);
      // The others are untouched.
      for (const other of REMINDER_KINDS) {
        if (expected[other] !== expected[kind]) expect(isKindEnabled(off, other)).toBe(true);
      }
    }
  });
});

test("showAmountsFor reads the switch of the channel", () => {
  const settings = { showAmountsTelegram: true, showAmountsPush: false };
  expect(showAmountsFor(settings, "telegram")).toBe(true);
  expect(showAmountsFor(settings, "push")).toBe(false);
});
