// reminders → the push web channel (R5) and its client, with the push service simulated: no
// network, no database. The rules are Telegram's: a failure that provably sent nothing may be
// retried, an ambiguous one (timeout) never; a gone subscription is revoked; every device gets one
// message and a partial failure does not duplicate it.
import { describe, expect, test, vi } from "vitest";
import {
  createWebPushChannel,
  pushPayload,
  type PushDevice,
  type PushDeviceStore,
} from "@/modules/reminders/channels/web-push/channel";
import {
  createWebPushClient,
  kindOfStatus,
  type PushFailureKind,
  type PushResult,
  type WebPushClient,
} from "@/modules/reminders/channels/web-push/client";
import {
  PUSH_BODY_MAX_LENGTH,
  PUSH_TTL_SECONDS,
  RETRYABLE_ERROR_CODES,
  UNREACHABLE_ERROR_CODE,
} from "@/modules/reminders/reminders-constants";

const KEYS = { p256dh: "p".repeat(87), auth: "a".repeat(22) };
const device = (id: string): PushDevice => ({
  id,
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  ...KEYS,
});

function fakeStore(devices: PushDevice[]) {
  const store = {
    listActive: vi.fn(async () => devices),
    revoke: vi.fn(async (id: string) => void id),
    markSuccess: vi.fn(async (ids: string[]) => void ids),
  } satisfies PushDeviceStore;
  return store;
}

/** A client that answers per endpoint (the id at the end of it). */
function fakeClient(answers: Record<string, PushResult>) {
  const send = vi.fn(async (target: { endpoint: string }, payload: string) => {
    void payload;
    return answers[target.endpoint.split("/").pop()!] ?? { ok: true as const };
  });
  return { send } satisfies WebPushClient;
}

const MESSAGE = { text: "Hoy: Leer · 2 tareas", dedupeKey: "briefing:2026-10-08" };
const failure = (kind: PushFailureKind): PushResult => ({ ok: false, kind });

describe("the payload", () => {
  test("is a title, the text and the tag, and nothing else", () => {
    expect(JSON.parse(pushPayload(MESSAGE))).toEqual({
      title: "brahua-os",
      body: "Hoy: Leer · 2 tareas",
      tag: "briefing:2026-10-08",
    });
  });

  test("the body is cut so a payload never nears the 4 KB limit", () => {
    const body = JSON.parse(pushPayload({ text: "x".repeat(5000), dedupeKey: "k" })).body;
    expect(body).toHaveLength(PUSH_BODY_MAX_LENGTH);
  });
});

describe("createWebPushChannel", () => {
  test("is the push channel", () => {
    expect(createWebPushChannel({ store: fakeStore([]), client: fakeClient({}) }).id).toBe("push");
  });

  test("sends the same payload to every active device and records the success", async () => {
    const store = fakeStore([device("a"), device("b")]);
    const client = fakeClient({});
    const result = await createWebPushChannel({ store, client }).send(MESSAGE);
    expect(result).toEqual({ ok: true });
    expect(client.send).toHaveBeenCalledTimes(2);
    const payloads = client.send.mock.calls.map((call) => call[1]);
    expect(new Set(payloads).size).toBe(1);
    expect(store.markSuccess).toHaveBeenCalledWith(["a", "b"]);
    expect(store.revoke).not.toHaveBeenCalled();
  });

  test("a 404/410 revokes that device; the others still get the message and the send is ok", async () => {
    const store = fakeStore([device("a"), device("b")]);
    const client = fakeClient({ a: failure("gone") });
    const result = await createWebPushChannel({ store, client }).send(MESSAGE);
    expect(result).toEqual({ ok: true });
    expect(store.revoke).toHaveBeenCalledTimes(1);
    expect(store.revoke).toHaveBeenCalledWith("a");
    expect(store.markSuccess).toHaveBeenCalledWith(["b"]);
  });

  test("when every device is gone the channel is unreachable (and each one is revoked)", async () => {
    const store = fakeStore([device("a"), device("b")]);
    const client = fakeClient({ a: failure("gone"), b: failure("gone") });
    const result = await createWebPushChannel({ store, client }).send(MESSAGE);
    expect(result).toEqual({ ok: false, code: UNREACHABLE_ERROR_CODE, unreachable: true });
    expect(store.revoke.mock.calls.map((call) => call[0]).sort()).toEqual(["a", "b"]);
    expect(store.markSuccess).not.toHaveBeenCalled();
  });

  test("no device at all (removed after the engine counted) is unreachable and sends nothing", async () => {
    const client = fakeClient({});
    const result = await createWebPushChannel({ store: fakeStore([]), client }).send(MESSAGE);
    expect(result).toEqual({ ok: false, code: UNREACHABLE_ERROR_CODE, unreachable: true });
    expect(client.send).not.toHaveBeenCalled();
  });

  test("a partial failure is not retried: the device that got it would receive a second copy", async () => {
    const store = fakeStore([device("a"), device("b")]);
    const client = fakeClient({ b: failure("server") });
    expect(await createWebPushChannel({ store, client }).send(MESSAGE)).toEqual({ ok: true });
  });

  test("a 401/403 (VAPID rejected) revokes the device like a gone one, logs it and does not lose the reminder to Telegram", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = fakeStore([device("a"), device("b")]);
    const client = fakeClient({ a: failure("auth_rejected"), b: failure("auth_rejected") });
    const result = await createWebPushChannel({ store, client }).send(MESSAGE);
    // Unreachable: the engine leaves push and the next tick falls back to Telegram.
    expect(result).toEqual({ ok: false, code: UNREACHABLE_ERROR_CODE, unreachable: true });
    expect(store.revoke.mock.calls.map((call) => call[0]).sort()).toEqual(["a", "b"]);
    const logged = error.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("push_vapid_rejected");
    expect(logged).not.toContain("fcm.googleapis.com");
    expect(logged).not.toContain(KEYS.auth);
    error.mockRestore();
  });

  test("a rejection on one device does not stop the others from receiving it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = fakeStore([device("a"), device("b")]);
    const client = fakeClient({ a: failure("auth_rejected") });
    expect(await createWebPushChannel({ store, client }).send(MESSAGE)).toEqual({ ok: true });
    expect(store.revoke).toHaveBeenCalledWith("a");
    vi.restoreAllMocks();
  });

  test.each([
    ["server", "push_server", false],
    ["bad_request", "push_bad_request", false],
    ["rate_limited", "push_rate_limited", true],
    ["config", "push_config", false],
    ["network", "push_network", false],
  ] as const)("every device failing with %s fails with %s", async (kind, code, backoff) => {
    const store = fakeStore([device("a")]);
    const result = await createWebPushChannel({
      store,
      client: fakeClient({ a: failure(kind) }),
    }).send(MESSAGE);
    expect(result).toEqual({ ok: false, code, ...(backoff ? { backoff: true } : {}) });
    expect(store.revoke).not.toHaveBeenCalled();
  });

  test("the retryable codes are exactly the clear failures: a timeout never is", () => {
    expect(RETRYABLE_ERROR_CODES).toEqual(
      expect.arrayContaining(["push_server", "push_bad_request", "push_rate_limited"]),
    );
    expect(RETRYABLE_ERROR_CODES).not.toContain("push_network");
    // A local configuration error cannot be fixed by trying again.
    expect(RETRYABLE_ERROR_CODES).not.toContain("push_config");
    expect(RETRYABLE_ERROR_CODES).not.toContain(UNREACHABLE_ERROR_CODE);
  });

  test("an ambiguous failure wins over a clear one, so the send is not retried", async () => {
    const store = fakeStore([device("a"), device("b")]);
    const client = fakeClient({ a: failure("server"), b: failure("network") });
    const result = await createWebPushChannel({ store, client }).send(MESSAGE);
    expect(result).toMatchObject({ ok: false, code: "push_network" });
    expect(RETRYABLE_ERROR_CODES).not.toContain((result as { code: string }).code);
  });

  test("a rate limit anywhere asks the engine to leave the channel alone", async () => {
    const client = fakeClient({ a: failure("rate_limited"), b: failure("server") });
    const result = await createWebPushChannel({
      store: fakeStore([device("a"), device("b")]),
      client,
    }).send(MESSAGE);
    expect(result).toMatchObject({ ok: false, backoff: true });
  });

  test("bookkeeping that fails never turns a delivered push into a failure", async () => {
    const store = fakeStore([device("a"), device("b")]);
    store.revoke.mockRejectedValue(new Error("db down"));
    store.markSuccess.mockRejectedValue(new Error("db down"));
    const client = fakeClient({ a: failure("gone") });
    expect(await createWebPushChannel({ store, client }).send(MESSAGE)).toEqual({ ok: true });
  });
});

describe("kindOfStatus", () => {
  test("classifies the push service's answer", () => {
    expect(kindOfStatus(404)).toBe("gone");
    expect(kindOfStatus(410)).toBe("gone");
    expect(kindOfStatus(429)).toBe("rate_limited");
    expect(kindOfStatus(500)).toBe("server");
    expect(kindOfStatus(503)).toBe("server");
    for (const status of [401, 403]) expect(kindOfStatus(status)).toBe("auth_rejected");
    for (const status of [400, 413]) expect(kindOfStatus(status)).toBe("bad_request");
  });
});

describe("createWebPushClient", () => {
  const VAPID = {
    publicKey: "B".padEnd(87, "x"),
    privateKey: "k".repeat(43),
    subject: "mailto:owner@example.com",
  };
  const TARGET = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", ...KEYS };

  test("sends with the VAPID details, a TTL of the grace window and normal urgency", async () => {
    const sendNotification = vi.fn(async () => ({ statusCode: 201 }));
    const client = createWebPushClient({ vapid: VAPID, sendNotification, timeoutMs: 1234 });
    expect(await client.send(TARGET, "{}")).toEqual({ ok: true });
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: TARGET.endpoint, keys: { p256dh: KEYS.p256dh, auth: KEYS.auth } },
      "{}",
      {
        vapidDetails: VAPID,
        TTL: PUSH_TTL_SECONDS,
        urgency: "normal",
        timeout: 1234,
      },
    );
    expect(PUSH_TTL_SECONDS).toBe(7200);
  });

  test("a WebPushError becomes its kind, whatever the service said", async () => {
    for (const [statusCode, kind] of [
      [410, "gone"],
      [404, "gone"],
      [429, "rate_limited"],
      [502, "server"],
      [403, "auth_rejected"],
      [401, "auth_rejected"],
      [413, "bad_request"],
    ] as const) {
      const error = Object.assign(new Error("the service said something private"), {
        statusCode,
        body: "endpoint and secrets",
      });
      const client = createWebPushClient({
        vapid: VAPID,
        sendNotification: async () => {
          throw error;
        },
      });
      expect(await client.send(TARGET, "{}")).toEqual({ ok: false, kind });
    }
  });

  test("a timeout or a socket error with no status is ambiguous: network", async () => {
    for (const error of [
      new Error("Socket timeout"),
      Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
    ]) {
      const client = createWebPushClient({
        vapid: VAPID,
        sendNotification: async () => {
          throw error;
        },
      });
      expect(await client.send(TARGET, "{}")).toEqual({ ok: false, kind: "network" });
    }
  });

  test("a synchronous error from web-push (keys that do not fit) is configuration, not network", async () => {
    for (const message of [
      "Vapid public key should be 65 bytes long when decoded.",
      "The subscription p256dh key should be 65 bytes long when decoded.",
      "Failed to derive a shared secret",
    ]) {
      const client = createWebPushClient({
        vapid: VAPID,
        sendNotification: async () => {
          throw new Error(message);
        },
      });
      expect(await client.send(TARGET, "{}")).toEqual({ ok: false, kind: "config" });
    }
  });

  test("the result carries nothing from the service", async () => {
    const client = createWebPushClient({
      vapid: VAPID,
      sendNotification: async () => {
        throw Object.assign(new Error(TARGET.endpoint), { statusCode: 500, body: KEYS.auth });
      },
    });
    const text = JSON.stringify(await client.send(TARGET, "{}"));
    expect(text).not.toContain(TARGET.endpoint);
    expect(text).not.toContain(KEYS.auth);
  });
});
