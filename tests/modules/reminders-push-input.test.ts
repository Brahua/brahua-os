// reminders → push/ (R5): what the browser may send (the endpoint allowlist is the SSRF guard), the
// VAPID environment, the device label and the browser rules. All pure.
import webpush from "web-push";
import { describe, expect, test } from "vitest";
import { resolveVapidEnv } from "@/modules/reminders/env";
import { channelNote } from "@/modules/reminders/channel-copy";
import {
  pushSupport,
  sameApplicationServerKey,
  urlBase64ToBytes,
  type BrowserFacts,
} from "@/modules/reminders/push/browser";
import { deviceLabel } from "@/modules/reminders/push/device-label";
import {
  isAllowedPushEndpoint,
  pushEndpointSchema,
  pushSubscriptionSchema,
  PUSH_ERRORS,
} from "@/modules/reminders/push/push-input";
import { formatVapidPair } from "../../scripts/reminders-vapid";

const KEYS = { p256dh: "B".padEnd(87, "x"), auth: "a".repeat(22) };

describe("isAllowedPushEndpoint", () => {
  test("accepts the endpoints of the real push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://fcm.googleapis.com/wp/xyz",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QAbc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
      "https://eu.push.apple.com/abc",
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  test("refuses everything else: other hosts, look-alikes, http, credentials, ports, junk", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://evil.example.com/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilfcm.googleapis.com.example/x",
      "https://notfcm.googleapis.com/x",
      "https://user:pass@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "https://push.apple.com.evil.example/x",
      "javascript:alert(1)",
      "not a url",
      "",
      `https://fcm.googleapis.com/${"a".repeat(2100)}`,
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });
});

describe("pushSubscriptionSchema", () => {
  const good = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: KEYS };

  test("accepts what PushSubscription.toJSON gives", () => {
    expect(pushSubscriptionSchema.safeParse(good).success).toBe(true);
  });

  test("is strict: an unknown key, at any level, is rejected", () => {
    expect(pushSubscriptionSchema.safeParse({ ...good, expirationTime: null }).success).toBe(false);
    expect(
      pushSubscriptionSchema.safeParse({ ...good, keys: { ...KEYS, extra: "x" } }).success,
    ).toBe(false);
  });

  test("keys must have the length and alphabet of real ones", () => {
    for (const keys of [
      { ...KEYS, p256dh: "short" },
      { ...KEYS, auth: "a".repeat(23) },
      { ...KEYS, auth: "a+/".padEnd(22, "a") },
      { p256dh: KEYS.p256dh },
    ]) {
      expect(pushSubscriptionSchema.safeParse({ ...good, keys }).success).toBe(false);
    }
  });

  test("a forbidden endpoint says so, in Spanish", () => {
    const result = pushSubscriptionSchema.safeParse({
      ...good,
      endpoint: "https://evil.example/x",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe(PUSH_ERRORS.endpoint);
  });

  test("the endpoint is normalized after it is validated (what is persisted is what was checked)", () => {
    const parsed = pushSubscriptionSchema.parse({
      endpoint: "HTTPS://FCM.GOOGLEAPIS.COM:443/fcm/send/AbC",
      keys: KEYS,
    });
    expect(parsed.endpoint).toBe("https://fcm.googleapis.com/fcm/send/AbC");
  });

  test("the endpoint-only schema applies the same allowlist", () => {
    expect(pushEndpointSchema.safeParse({ endpoint: good.endpoint }).success).toBe(true);
    expect(pushEndpointSchema.safeParse({ endpoint: "https://evil.example/x" }).success).toBe(
      false,
    );
    expect(pushEndpointSchema.safeParse({ endpoint: good.endpoint, id: "x" }).success).toBe(false);
  });
});

describe("resolveVapidEnv", () => {
  // The pair is generated here and never printed: it only has to look like what the script makes.
  const keys = webpush.generateVAPIDKeys();
  const GOOD = {
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: "mailto:owner@example.com",
  };

  test("accepts a generated pair with a mailto or an https subject", () => {
    expect(resolveVapidEnv(GOOD).ok).toBe(true);
    expect(resolveVapidEnv({ ...GOOD, VAPID_SUBJECT: "https://os.brahua.com" }).ok).toBe(true);
    const result = resolveVapidEnv({ ...GOOD, VAPID_PUBLIC_KEY: ` ${keys.publicKey}\n` });
    expect(result.ok && result.value.publicKey).toBe(keys.publicKey);
  });

  test("absent means not available: it says which variables, never their values", () => {
    const result = resolveVapidEnv({});
    expect(result).toEqual({
      ok: false,
      problems: ["VAPID_PUBLIC_KEY falta", "VAPID_PRIVATE_KEY falta", "VAPID_SUBJECT falta"],
    });
  });

  test("a private key that is not the public key's pair makes push unavailable, naming variables only", () => {
    const other = webpush.generateVAPIDKeys();
    const result = resolveVapidEnv({ ...GOOD, VAPID_PRIVATE_KEY: other.privateKey });
    expect(result).toEqual({
      ok: false,
      problems: ["VAPID_PRIVATE_KEY no corresponde a VAPID_PUBLIC_KEY"],
    });
  });

  test("a public key that is well shaped but not a point of the curve is refused", () => {
    const result = resolveVapidEnv({ ...GOOD, VAPID_PUBLIC_KEY: "B".padEnd(87, "x") });
    expect(result.ok).toBe(false);
  });

  test("malformed values are refused and the problems carry no value", () => {
    const bad = resolveVapidEnv({
      VAPID_PUBLIC_KEY: "not-a-key",
      VAPID_PRIVATE_KEY: "secret-but-short",
      VAPID_SUBJECT: "http://insecure.example",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.problems).toHaveLength(3);
    const text = bad.problems.join(" ");
    expect(text).not.toContain("not-a-key");
    expect(text).not.toContain("secret-but-short");
    expect(text).not.toContain("insecure.example");
  });
});

describe("formatVapidPair (the script's output)", () => {
  test("has both variables, the reminder of the subject and no extra secret", () => {
    const output = formatVapidPair({ publicKey: "PUB", privateKey: "PRIV" });
    expect(output).toContain("VAPID_PUBLIC_KEY=PUB");
    expect(output).toContain("VAPID_PRIVATE_KEY=PRIV");
    expect(output).toContain("VAPID_SUBJECT");
  });
});

describe("deviceLabel", () => {
  test.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      "iPhone · Safari",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mac · Chrome",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
      "Windows · Edge",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "Linux · Firefox"],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      "Android · Chrome",
    ],
    ["", "Dispositivo"],
    ["curl/8.0", "Dispositivo"],
  ])("%s → %s", (userAgent, label) => {
    expect(deviceLabel(userAgent)).toBe(label);
  });

  test("null and undefined are just a device", () => {
    expect(deviceLabel(null)).toBe("Dispositivo");
    expect(deviceLabel(undefined)).toBe("Dispositivo");
  });
});

describe("pushSupport", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
  const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0.0.0 Safari/537.36";
  const facts = (overrides: Partial<BrowserFacts>): BrowserFacts => ({
    userAgent: CHROME,
    platform: "MacIntel",
    maxTouchPoints: 0,
    standalone: false,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    ...overrides,
  });

  test("a desktop browser that has the three APIs can subscribe, installed or not", () => {
    expect(pushSupport(facts({}))).toBe("supported");
    expect(pushSupport(facts({ standalone: true }))).toBe("supported");
  });

  test("an iPhone in a Safari tab needs the app installed (it has no PushManager there)", () => {
    expect(
      pushSupport(facts({ userAgent: IPHONE, platform: "iPhone", hasPushManager: false })),
    ).toBe("needs_install");
  });

  test("an iPad in desktop mode is also iOS", () => {
    expect(pushSupport(facts({ maxTouchPoints: 5, hasPushManager: false }))).toBe("needs_install");
  });

  test("the installed iPhone app can subscribe", () => {
    expect(
      pushSupport(
        facts({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5, standalone: true }),
      ),
    ).toBe("supported");
  });

  test("a browser without the APIs is unsupported", () => {
    expect(pushSupport(facts({ hasPushManager: false }))).toBe("unsupported");
    expect(pushSupport(facts({ hasServiceWorker: false }))).toBe("unsupported");
    expect(pushSupport(facts({ hasNotification: false }))).toBe("unsupported");
  });
});

describe("the server key", () => {
  test("base64url becomes the bytes the browser wants", () => {
    expect([...urlBase64ToBytes("AQID")]).toEqual([1, 2, 3]);
    // url-safe alphabet and missing padding.
    expect([...urlBase64ToBytes("-_8")]).toEqual([251, 255]);
  });

  test("a subscription made with another key is detected; an unknown one is kept", () => {
    const key = new Uint8Array([1, 2, 3]);
    expect(sameApplicationServerKey(new Uint8Array([1, 2, 3]).buffer, key)).toBe(true);
    expect(sameApplicationServerKey(new Uint8Array([1, 2, 4]).buffer, key)).toBe(false);
    expect(sameApplicationServerKey(new Uint8Array([1, 2]).buffer, key)).toBe(false);
    expect(sameApplicationServerKey(null, key)).toBe(true);
    expect(sameApplicationServerKey(undefined, key)).toBe(true);
  });
});

describe("channelNote", () => {
  test("says what will happen, the fallback to Telegram included", () => {
    expect(channelNote({ deliveryChannel: "push", effective: ["push"], devices: 1 })).toBe(
      "Los avisos llegan por push (1 dispositivo).",
    );
    expect(channelNote({ deliveryChannel: "push", effective: ["push"], devices: 2 })).toContain(
      "2 dispositivos",
    );
    expect(channelNote({ deliveryChannel: "push", effective: ["telegram"], devices: 0 })).toContain(
      "mientras tanto los avisos llegan por Telegram",
    );
    expect(channelNote({ deliveryChannel: "telegram", effective: ["telegram"], devices: 3 })).toBe(
      "Los avisos llegan por Telegram.",
    );
    expect(
      channelNote({ deliveryChannel: "both", effective: ["push", "telegram"], devices: 1 }),
    ).toBe("Los avisos llegan por push (1 dispositivo) y por Telegram.");
    expect(channelNote({ deliveryChannel: "both", effective: ["push"], devices: 1 })).toContain(
      "Conecta Telegram",
    );
  });

  test("with nothing available it says nothing is sent, and what to do", () => {
    expect(channelNote({ deliveryChannel: "push", effective: [], devices: 0 })).toContain(
      "no se envía ningún aviso",
    );
    expect(channelNote({ deliveryChannel: "telegram", effective: [], devices: 0 })).toContain(
      "Telegram no está conectado",
    );
  });
});
