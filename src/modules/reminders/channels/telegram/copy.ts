// What the bot says (SPEC-reminders "Telegram": short Spanish messages, never guilt, with a link
// to the app). Plain strings and small pure functions, so a test can check them all against the
// forbidden words. Text typed by the owner appears only in the reply to that same message, never
// in a log.

/** Reply to a valid `/start <code>`: the chat is linked. */
export const BOT_LINKED_MESSAGE =
  "Listo, brahua-os quedó conectado a este chat. Desde aquí te iré avisando.";

/** `/ayuda`, and a bare `/start` from the linked chat. The only message longer than a few lines. */
export const BOT_HELP_MESSAGE = [
  "Escríbeme y lo anoto:",
  "• «pilas mañana» crea una tarea con su fecha.",
  "• «12.50 café» registra un gasto.",
  "• Lo que no entiendo queda en tu bandeja de tareas.",
  "Comandos:",
  "/tarea <texto> guarda una tarea.",
  "/gasto <monto> <detalle> guarda un gasto (por ejemplo /gasto café 12).",
  "/hoy te cuenta tu día.",
  "/ayuda muestra este mensaje.",
].join("\n");

/** `/hoy` on a day with nothing in it. */
export const BOT_TODAY_EMPTY_MESSAGE = "Hoy no tienes nada pendiente.";

/** `/hoy` when the day could not be read (a source failed): the owner can ask again. */
export const BOT_TODAY_FAILED_MESSAGE = "No pude leer tu día ahora. Prueba de nuevo en un rato.";

/** An unknown `/command`: nothing is captured. */
export const BOT_UNKNOWN_COMMAND_MESSAGE =
  "No conozco ese comando. Con /ayuda ves lo que sé hacer.";

/** A photo, a voice note, a sticker…: only text is read for now. */
export const BOT_NON_TEXT_MESSAGE = "Por ahora solo leo texto. Escríbemelo y lo anoto.";

/** `/tarea` or `/gasto` with nothing after it. */
export const BOT_TASK_USAGE_MESSAGE =
  "Escribe la tarea después del comando. Por ejemplo: /tarea pilas mañana";
export const BOT_EXPENSE_USAGE_MESSAGE =
  "Escribe el monto después del comando. Por ejemplo: /gasto café 12";

/** `/gasto` with text but no amount in it. */
export const BOT_NO_AMOUNT_MESSAGE =
  "No encontré el monto. Pon el número al inicio o al final, por ejemplo: /gasto café 12";

/** The text is valid but the app cannot store it (too long, empty after cleaning…). */
export const BOT_TOO_LONG_TASK_MESSAGE =
  "Es muy largo para una tarea (máximo 200 letras). Acórtalo y mándamelo de nuevo.";
export const BOT_TOO_LONG_EXPENSE_MESSAGE =
  "Es muy largo para un gasto (el detalle admite 80 letras). Acórtalo y mándamelo de nuevo.";
export const BOT_INVALID_MESSAGE = "No pude guardarlo. Prueba de nuevo con otras palabras.";

/** The "Deshacer" button and its answers (shown as a toast by Telegram). */
export const BOT_UNDO_BUTTON = "Deshacer";
export const BOT_UNDONE_MESSAGE = "Deshecho.";
export const BOT_UNDO_CHANGED_MESSAGE = "Ya lo cambiaste en la app, así que no lo toqué.";
export const BOT_UNDO_GONE_MESSAGE = "Ya no estaba en la app.";

/** Longest piece of the owner's text echoed back in a reply (Telegram allows 4096 characters). */
const ECHO_MAX = 120;

function echo(text: string): string {
  return text.length > ECHO_MAX ? `${text.slice(0, ECHO_MAX - 1).trimEnd()}…` : text;
}

/**
 * «Anotado: pilas · vie 9 oct» for a task with a day (and hour); «A la bandeja: ideas para el
 * viaje» for one without: the bot says where what it did not date went (SPEC story 6).
 */
export function taskCapturedReply(title: string, dueLabel: string | null): string {
  return dueLabel ? `Anotado: ${echo(title)} · ${dueLabel}` : `A la bandeja: ${echo(title)}`;
}

/** «Gasto: S/ 12.50 · café». */
export function expenseCapturedReply(amountLabel: string, description: string | null): string {
  return description ? `Gasto: ${amountLabel} · ${echo(description)}` : `Gasto: ${amountLabel}`;
}

/** The short, fixed messages, for the forbidden-words and length tests. */
export const BOT_MESSAGES: readonly string[] = [
  BOT_LINKED_MESSAGE,
  BOT_TODAY_EMPTY_MESSAGE,
  BOT_TODAY_FAILED_MESSAGE,
  BOT_UNKNOWN_COMMAND_MESSAGE,
  BOT_NON_TEXT_MESSAGE,
  BOT_TASK_USAGE_MESSAGE,
  BOT_EXPENSE_USAGE_MESSAGE,
  BOT_NO_AMOUNT_MESSAGE,
  BOT_TOO_LONG_TASK_MESSAGE,
  BOT_TOO_LONG_EXPENSE_MESSAGE,
  BOT_INVALID_MESSAGE,
  BOT_UNDO_BUTTON,
  BOT_UNDONE_MESSAGE,
  BOT_UNDO_CHANGED_MESSAGE,
  BOT_UNDO_GONE_MESSAGE,
];
