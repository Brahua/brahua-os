// Test-only values of the `reminders` E2E, with no imports: playwright.config.ts reads them to start
// the app (and the fake Telegram) and the specs read them to talk to both.
//
// Not secrets: they only exist in the throwaway E2E app and its fake Telegram.
import { createECDH } from "node:crypto";

export const E2E_TELEGRAM = {
  token: "123456:e2e-token-not-a-real-one",
  webhookSecret: "e2e-webhook-secret-0123456789",
  botUsername: "brahua_e2e_bot",
  cronSecret: "e2e-cron-secret-0123456789abcdef",
} as const;

/**
 * Push web (R5): a throwaway VAPID pair, made when the config loads, so the app reports push as
 * configured (it checks that the two keys match). It is a key of nothing: no E2E ever sends a push
 * (the push service is never reached from CI; the browser side is a simulated PushManager, see
 * e2e/reminders.spec.ts). Only the app process reads it (playwright.config.ts passes it on).
 */
const e2eKeys = createECDH("prime256v1");
e2eKeys.generateKeys();
export const E2E_VAPID = {
  publicKey: e2eKeys.getPublicKey().toString("base64url"),
  privateKey: e2eKeys.getPrivateKey().toString("base64url"),
  subject: "mailto:e2e@example.com",
} as const;

/** The webhook's secret header, as Telegram sends it. */
export const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** The chat the specs pretend to be (a private chat id beyond 32 bits, like a real one). */
export const E2E_CHAT_ID = 5_000_000_001;

/** Next to the app's port, so parallel local runs (E2E_PORT) never share a fake Telegram. */
export const FAKE_TELEGRAM_PORT = Number(
  process.env.E2E_TELEGRAM_PORT ?? Number(process.env.E2E_PORT ?? 3417) + 10,
);
export const FAKE_TELEGRAM_URL = `http://127.0.0.1:${FAKE_TELEGRAM_PORT}`;
