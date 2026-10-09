// What a message to the bot means (SPEC-reminders "Bot de Telegram → Captura" y "Comandos").
// PURE: no database, no clock. The webhook acts on the answer.
//
//   /ayuda, /hoy, /start        commands (nothing else: any other "/word" is an unknown command and
//                               is NEVER saved as a task)
//   /tarea <texto>              forces a task; /gasto <texto> forces an expense
//   anything else               a capture: an expense ONLY when the amount has decimals or a
//                               currency mark («12.50 café», «S/ 12», «$5»); otherwise a task.
//                               «pilas 3» and «café 12» are tasks (decisión autónoma de la spec).
//
// A text the parser does not understand is still a task (title = the text): it lands in the inbox
// and nothing is lost.
import { parseExpenseText } from "@/lib/natural-date";

export type BotIntent =
  | { kind: "ignore" }
  | { kind: "start" }
  | { kind: "help" }
  | { kind: "today" }
  | { kind: "unknown_command" }
  /** `/tarea` or `/gasto` with nothing after it. */
  | { kind: "usage"; capture: "task" | "expense" }
  | { kind: "capture"; capture: "task" | "expense"; text: string; forced: boolean };

/** «/gasto@mi_bot café 12» → command "gasto", rest "café 12". Telegram adds `@bot` in groups. */
const COMMAND = /^\/([^\s@]*)(?:@\S+)?(?:\s+([\s\S]*))?$/;

/**
 * The expense the text carries on its own: an amount with decimals («12.50», «12,5») or with a
 * currency mark («S/ 12», «$5», «12 soles»). A bare integer is not enough.
 */
export function looksLikeExpense(text: string): boolean {
  const reading = parseExpenseText(text);
  if (reading.amountCents === null) return false;
  if (reading.currency !== null) return true;
  return reading.interpreted.some((piece) => /\d[.,]\d/.test(piece));
}

export function classifyMessage(raw: string): BotIntent {
  const text = raw.trim();
  if (text === "") return { kind: "ignore" };

  if (text.startsWith("/")) {
    const match = COMMAND.exec(text);
    const command = match?.[1]?.toLowerCase() ?? "";
    const rest = (match?.[2] ?? "").trim();
    switch (command) {
      case "start":
        return { kind: "start" };
      case "ayuda":
      case "help":
        return { kind: "help" };
      case "hoy":
        return { kind: "today" };
      case "tarea":
      case "gasto": {
        const capture = command === "tarea" ? "task" : "expense";
        return rest === ""
          ? { kind: "usage", capture }
          : { kind: "capture", capture, text: rest, forced: true };
      }
      default:
        return { kind: "unknown_command" };
    }
  }

  return {
    kind: "capture",
    capture: looksLikeExpense(text) ? "expense" : "task",
    text,
    forced: false,
  };
}
