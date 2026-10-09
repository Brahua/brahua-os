// Push web as a ReminderChannel (R5; Telegram is channels/telegram/channel.ts, the model). One
// message goes to EVERY active device. Rules, the same as Telegram's:
// - at least one device took it: `ok` (a device that failed meanwhile is not retried: that would
//   send a second copy to the ones that got it; a missed reminder beats a duplicate);
// - 404/410 revokes that subscription (kept, not deleted) and does not count as a failure of the send;
//   when ALL the devices are gone the channel is `unreachable` (the engine leaves it for the rest of
//   the tick and the next one falls back to Telegram);
// - otherwise it fails with the code of the failure; an ambiguous one (`push_network`: a timeout may
//   have delivered) wins over a clear one, so it is not retried (RETRYABLE_ERROR_CODES);
// - a 429 asks the engine to leave the channel alone until the next tick (`backoff`).
// The payload is minimal: a title, the text of the reminder (already built without amounts when the
// owner left them off) and the `tag` that makes a new notification replace the old one.
import "server-only";
import { describeError } from "@/lib/describe-error";
import type { ChannelSendResult, ReminderChannel } from "../../contracts";
import { logEvent } from "../../log";
import {
  PUSH_BODY_MAX_LENGTH,
  PUSH_TITLE,
  UNREACHABLE_ERROR_CODE,
} from "../../reminders-constants";
import type { PushFailureKind, PushTarget, WebPushClient } from "./client";

/** A stored subscription, as the channel needs it. */
export type PushDevice = PushTarget & { id: string };

/** Where the subscriptions live (push/subscriptions.ts over the database; a fake in unit tests). */
export type PushDeviceStore = {
  listActive(): Promise<PushDevice[]>;
  revoke(id: string): Promise<void>;
  markSuccess(ids: string[]): Promise<void>;
};

/** The JSON the service worker reads (public/sw.js). Nothing but what it shows. */
export function pushPayload(message: { text: string; dedupeKey: string }): string {
  return JSON.stringify({
    title: PUSH_TITLE,
    body: message.text.slice(0, PUSH_BODY_MAX_LENGTH),
    tag: message.dedupeKey,
  });
}

const CODE_OF_KIND: Record<Exclude<PushFailureKind, "gone">, string> = {
  rate_limited: "push_rate_limited",
  bad_request: "push_bad_request",
  server: "push_server",
  network: "push_network",
};
// From the least to the most worrying: the code of an all-failed send is the last one present.
const SEVERITY: Exclude<PushFailureKind, "gone">[] = [
  "bad_request",
  "server",
  "rate_limited",
  "network",
];

export function createWebPushChannel(options: {
  store: PushDeviceStore;
  client: WebPushClient;
}): ReminderChannel {
  const { store, client } = options;
  return {
    id: "push",
    async send(message): Promise<ChannelSendResult> {
      const devices = await store.listActive();
      // No device (it was removed after the engine counted): nothing to reach any more.
      if (devices.length === 0) {
        return { ok: false, code: UNREACHABLE_ERROR_CODE, unreachable: true };
      }
      const payload = pushPayload(message);
      const results = await Promise.all(
        devices.map(async (device) => ({ device, result: await client.send(device, payload) })),
      );

      const delivered: string[] = [];
      const gone: string[] = [];
      const failures = new Set<Exclude<PushFailureKind, "gone">>();
      for (const { device, result } of results) {
        if (result.ok) delivered.push(device.id);
        else if (result.kind === "gone") gone.push(device.id);
        else failures.add(result.kind);
      }

      // Bookkeeping never turns a send that happened into a failure.
      for (const id of gone) {
        try {
          await store.revoke(id);
        } catch (error) {
          logEvent("warn", "push_revoke_failed", describeError(error));
        }
      }
      if (gone.length > 0) logEvent("info", "push_subscriptions_revoked", { count: gone.length });
      if (delivered.length > 0) {
        try {
          await store.markSuccess(delivered);
        } catch (error) {
          logEvent("warn", "push_mark_success_failed", describeError(error));
        }
        return { ok: true };
      }

      if (failures.size === 0) {
        // Every device was gone (and is revoked now).
        return { ok: false, code: UNREACHABLE_ERROR_CODE, unreachable: true };
      }
      const worst = SEVERITY.filter((kind) => failures.has(kind)).at(-1)!;
      return {
        ok: false,
        code: CODE_OF_KIND[worst],
        ...(failures.has("rate_limited") ? { backoff: true } : {}),
      };
    },
  };
}
