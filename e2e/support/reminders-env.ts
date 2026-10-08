// Test-only values of the `reminders` E2E, with no imports: playwright.config.ts reads them to start
// the app (and the fake Telegram) and the specs read them to talk to both.
//
// Not secrets: they only exist in the throwaway E2E app and its fake Telegram.
export const E2E_TELEGRAM = {
  token: "123456:e2e-token-not-a-real-one",
  webhookSecret: "e2e-webhook-secret-0123456789",
  botUsername: "brahua_e2e_bot",
  cronSecret: "e2e-cron-secret-0123456789abcdef",
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
