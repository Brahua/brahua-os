// What the bot says (SPEC-reminders "Telegram": short Spanish messages, never guilt, with a link
// to the app). Plain strings, so a test can check them all against the forbidden words.

/** Reply to a valid `/start <code>`: the chat is linked. */
export const BOT_LINKED_MESSAGE =
  "Listo, brahua-os quedó conectado a este chat. Desde aquí te iré avisando.";

/** Everything the bot can say in R1, for the forbidden-words test. R3 adds the capture replies. */
export const BOT_MESSAGES: readonly string[] = [BOT_LINKED_MESSAGE];
