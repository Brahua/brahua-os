// The `web-push` library behind an interface (SPEC-reminders "Push web"): the channel depends on
// `WebPushClient`, never on the library, so its tests simulate the push service. Like the Telegram
// client, nothing the service said (and no endpoint, no key) goes into a result or an error: every
// failure is reduced to a `kind`.
import "server-only";
import webpush from "web-push";
import type { VapidEnv } from "../../env";
import { PUSH_TTL_SECONDS } from "../../reminders-constants";

/** Where one message goes: a browser's subscription. The keys are secrets. */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type PushFailureKind =
  /** 404/410: the subscription is gone for good (uninstalled, expired, permission revoked). */
  | "gone"
  | "rate_limited"
  /** 4xx other than the above (a payload the service refused, VAPID keys it does not accept). */
  | "bad_request"
  | "server"
  /** A timeout or a dropped connection: the message may have been queued anyway. */
  | "network";

export type PushResult = { ok: true } | { ok: false; kind: PushFailureKind };

export type WebPushClient = {
  send(target: PushTarget, payload: string): Promise<PushResult>;
};

/** The part of `webpush.sendNotification` this file uses (injectable for tests). */
export type SendNotification = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;

export type WebPushClientOptions = {
  vapid: VapidEnv;
  sendNotification?: SendNotification;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

export function kindOfStatus(status: number): PushFailureKind {
  if (status === 404 || status === 410) return "gone";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}

export function createWebPushClient(options: WebPushClientOptions): WebPushClient {
  const { vapid } = options;
  const sendNotification: SendNotification = options.sendNotification ?? webpush.sendNotification;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async send(target, payload): Promise<PushResult> {
      try {
        await sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
          {
            // Per call, so there is no global VAPID state to leak between callers.
            vapidDetails: {
              subject: vapid.subject,
              publicKey: vapid.publicKey,
              privateKey: vapid.privateKey,
            },
            // A reminder is worth sending until the end of its grace window, not a day later.
            TTL: PUSH_TTL_SECONDS,
            urgency: "normal",
            timeout,
          },
        );
        return { ok: true };
      } catch (error) {
        // `WebPushError` carries the HTTP status of the push service. Anything else (a timeout, a
        // reset socket) says nothing about whether the service got the message: ambiguous.
        const status = (error as { statusCode?: unknown } | null)?.statusCode;
        if (typeof status === "number") return { ok: false, kind: kindOfStatus(status) };
        return { ok: false, kind: "network" };
      }
    },
  };
}
