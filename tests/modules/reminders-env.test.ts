// reminders → env.ts: the variables, and the constant-time comparison behind the tick and the
// webhook. The messages name variables, never values.
import { describe, expect, test } from "vitest";
import {
  bearerToken,
  isTickAuthorized,
  isWebhookAuthorized,
  resolveTelegramEnv,
  safeEqual,
  telegramWebhookUrl,
  tickSecrets,
} from "@/modules/reminders/env";

const GOOD = {
  TELEGRAM_BOT_TOKEN: "123456:AAE-secret_token-value",
  TELEGRAM_WEBHOOK_SECRET: "a-webhook-secret-0123456789",
  TELEGRAM_BOT_USERNAME: "@brahua_bot",
  BETTER_AUTH_URL: "https://os.brahua.com",
};

describe("resolveTelegramEnv", () => {
  test("reads everything, strips the @ and defaults to the official API", () => {
    const result = resolveTelegramEnv(GOOD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.botUsername).toBe("brahua_bot");
    expect(result.value.apiBase).toBe("https://api.telegram.org");
    expect(result.value.appOrigin).toBe("https://os.brahua.com");
    expect(telegramWebhookUrl(result.value)).toBe("https://os.brahua.com/api/telegram/webhook");
  });

  test("TELEGRAM_API_BASE overrides the API (the fake server of the tests)", () => {
    const result = resolveTelegramEnv({ ...GOOD, TELEGRAM_API_BASE: "http://127.0.0.1:4000/" });
    expect(result.ok && result.value.apiBase).toBe("http://127.0.0.1:4000");
  });

  test("lists what is missing by variable name", () => {
    const result = resolveTelegramEnv({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join("\n")).toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(result.problems.join("\n")).toMatch(/TELEGRAM_WEBHOOK_SECRET/);
    expect(result.problems.join("\n")).toMatch(/TELEGRAM_BOT_USERNAME/);
    expect(result.problems.join("\n")).toMatch(/BETTER_AUTH_URL/);
  });

  test("a malformed value is reported without printing it", () => {
    const secretLooking = "has spaces and ñ";
    const result = resolveTelegramEnv({
      ...GOOD,
      TELEGRAM_WEBHOOK_SECRET: secretLooking,
      TELEGRAM_BOT_TOKEN: "tok/en with slash",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.problems.join("\n");
    expect(text).toMatch(/TELEGRAM_WEBHOOK_SECRET/);
    expect(text).toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(text).not.toContain(secretLooking);
    expect(text).not.toContain("tok/en");
  });

  test("rejects a short webhook secret and a bad API base", () => {
    expect(resolveTelegramEnv({ ...GOOD, TELEGRAM_WEBHOOK_SECRET: "short" }).ok).toBe(false);
    expect(resolveTelegramEnv({ ...GOOD, TELEGRAM_API_BASE: "ftp://x" }).ok).toBe(false);
  });
});

describe("safeEqual", () => {
  test("matches equal strings only", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(false); // an empty expected secret never matches
  });
});

describe("bearerToken", () => {
  test("reads a Bearer header", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer   abc ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("tick authorization", () => {
  const SECRET = "tick-secret-0123456789abcdef";
  const VERCEL = "vercel-cron-secret-0123456789";

  test("accepts REMINDERS_CRON_SECRET (Actions) and CRON_SECRET (Vercel Cron)", () => {
    const env = { REMINDERS_CRON_SECRET: SECRET, CRON_SECRET: VERCEL };
    expect(isTickAuthorized(`Bearer ${SECRET}`, env)).toBe(true);
    expect(isTickAuthorized(`Bearer ${VERCEL}`, env)).toBe(true);
  });

  test("rejects a wrong, empty or missing token", () => {
    const env = { REMINDERS_CRON_SECRET: SECRET };
    expect(isTickAuthorized("Bearer nope", env)).toBe(false);
    expect(isTickAuthorized(`Bearer ${SECRET}x`, env)).toBe(false);
    expect(isTickAuthorized(SECRET, env)).toBe(false);
    expect(isTickAuthorized(null, env)).toBe(false);
  });

  test("with no secret configured nothing is accepted, not even an empty token", () => {
    expect(isTickAuthorized("Bearer ", {})).toBe(false);
    expect(isTickAuthorized("Bearer x", {})).toBe(false);
    expect(isTickAuthorized("Bearer undefined", {})).toBe(false);
  });

  test("a secret shorter than 16 characters is treated as not set", () => {
    expect(tickSecrets({ REMINDERS_CRON_SECRET: "short" })).toEqual([]);
    expect(isTickAuthorized("Bearer short", { REMINDERS_CRON_SECRET: "short" })).toBe(false);
  });
});

describe("webhook authorization", () => {
  test("only the exact secret passes", () => {
    const env = { TELEGRAM_WEBHOOK_SECRET: GOOD.TELEGRAM_WEBHOOK_SECRET };
    expect(isWebhookAuthorized(GOOD.TELEGRAM_WEBHOOK_SECRET, env)).toBe(true);
    expect(isWebhookAuthorized("other", env)).toBe(false);
    expect(isWebhookAuthorized(null, env)).toBe(false);
    expect(isWebhookAuthorized("anything", {})).toBe(false);
  });
});

describe("secrets as the owner pastes them", () => {
  const SECRET = "tick-secret-0123456789abcdef";

  test("a tick secret with a trailing newline or spaces still matches the header Actions sends", () => {
    expect(tickSecrets({ REMINDERS_CRON_SECRET: `${SECRET}\n` })).toEqual([SECRET]);
    expect(isTickAuthorized(`Bearer ${SECRET}`, { REMINDERS_CRON_SECRET: `${SECRET}\n` })).toBe(
      true,
    );
    expect(isTickAuthorized(`Bearer ${SECRET}`, { CRON_SECRET: `  ${SECRET}  ` })).toBe(true);
  });

  test("only whitespace, or a short secret once trimmed, is not a secret", () => {
    expect(tickSecrets({ REMINDERS_CRON_SECRET: "                \n" })).toEqual([]);
    expect(tickSecrets({ CRON_SECRET: "short   \n" })).toEqual([]);
  });

  test("the webhook secret follows the same 16–256 rule as resolveTelegramEnv", () => {
    const strong = "a-webhook-secret-0123456789";
    expect(isWebhookAuthorized(strong, { TELEGRAM_WEBHOOK_SECRET: `${strong}\n` })).toBe(true);
    // Too short, too long and a forbidden character: the endpoint accepts nothing, even the
    // exact value (a weak configured secret must not be what protects it).
    for (const weak of ["short", "x".repeat(257), "has spaces in it 0123456789"]) {
      expect(isWebhookAuthorized(weak, { TELEGRAM_WEBHOOK_SECRET: weak })).toBe(false);
    }
    expect(isWebhookAuthorized("x".repeat(256), { TELEGRAM_WEBHOOK_SECRET: "x".repeat(256) })).toBe(
      true,
    );
  });
});

describe("TELEGRAM_API_BASE in production", () => {
  test("a Vercel production deployment refuses a plain http base (the token is in the URL)", () => {
    const http = { ...GOOD, TELEGRAM_API_BASE: "http://127.0.0.1:4000" };
    const refused = resolveTelegramEnv({ ...http, VERCEL_ENV: "production" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.problems.join(" ")).toMatch(/TELEGRAM_API_BASE/);
    // Positive controls: https in production, and http where it is not a Vercel production.
    expect(
      resolveTelegramEnv({
        ...GOOD,
        TELEGRAM_API_BASE: "https://telegram.example.test",
        VERCEL_ENV: "production",
      }).ok,
    ).toBe(true);
    expect(resolveTelegramEnv({ ...http, VERCEL_ENV: "preview" }).ok).toBe(true);
    expect(resolveTelegramEnv(http).ok).toBe(true);
  });
});
