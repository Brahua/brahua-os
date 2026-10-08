// Pure: which channels a reminder goes through and which kinds are switched on (SPEC-reminders
// "Respaldo de canal" and "Ajustes"). The engine asks; nothing here touches the database.
import type { ChannelId, DeliveryChannel, ReminderKind } from "./reminders-constants";

export type ChannelState = {
  deliveryChannel: DeliveryChannel;
  /** At least one push subscription that was not revoked. */
  hasPushDevices: boolean;
  /** Push can actually send (its channel exists and its keys are set), not only a device row. */
  pushAvailable: boolean;
  /** A Telegram chat is linked. */
  telegramConnected: boolean;
};

/**
 * The channels to send through, in order:
 * - `push`: the device(s); while there is none (or push cannot send), Telegram if it is connected
 *   (the default is push, and nothing should be lost just because the owner has not activated the
 *   phone yet).
 * - `telegram`: Telegram, if connected.
 * - `both`: each one that is available.
 * With no channel available nothing is sent.
 */
export function selectChannels(state: ChannelState): ChannelId[] {
  const { deliveryChannel, telegramConnected } = state;
  // A subscribed device is useless without a working push channel: Telegram takes over.
  const hasPushDevices = state.hasPushDevices && state.pushAvailable;
  if (deliveryChannel === "telegram") return telegramConnected ? ["telegram"] : [];
  if (deliveryChannel === "both") {
    return [
      ...(hasPushDevices ? (["push"] as const) : []),
      ...(telegramConnected ? (["telegram"] as const) : []),
    ];
  }
  if (hasPushDevices) return ["push"];
  return telegramConnected ? ["telegram"] : [];
}

export type KindSwitches = {
  briefingEnabled: boolean;
  paymentsEnabled: boolean;
  eveningEnabled: boolean;
  habitTimesEnabled: boolean;
};

/** Whether the owner left this kind of reminder on. */
export function isKindEnabled(settings: KindSwitches, kind: ReminderKind): boolean {
  switch (kind) {
    case "briefing":
      return settings.briefingEnabled;
    case "payment_eve":
    case "payment_followup":
      return settings.paymentsEnabled;
    case "evening_review":
      return settings.eveningEnabled;
    case "habit_time":
      return settings.habitTimesEnabled;
  }
}

export type AmountSwitches = { showAmountsTelegram: boolean; showAmountsPush: boolean };

/** The "show amounts" switch of a channel. */
export function showAmountsFor(settings: AmountSwitches, channel: ChannelId): boolean {
  return channel === "push" ? settings.showAmountsPush : settings.showAmountsTelegram;
}
