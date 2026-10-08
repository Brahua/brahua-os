// Runs the fake Telegram Bot API as its own process for the E2E (playwright.config.ts starts it as
// a second `webServer`, next to the app): the app's `TELEGRAM_API_BASE` points here, and a spec
// reads what the app sent (and makes the next call fail) through the control API
// (e2e/support/reminders.ts). Never started outside the tests.
import { startFakeTelegram } from "../../tests/support/fake-telegram";

const port = Number(process.env.E2E_TELEGRAM_PORT ?? 3427);

startFakeTelegram(port)
  .then((fake) => {
    console.log(`Fake Telegram listening on ${fake.url}`);
    const stop = () => void fake.close().finally(() => process.exit(0));
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
