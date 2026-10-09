// R3 of `reminders`: what a message to the bot means (SPEC-reminders "Captura" y "Comandos"). Pure.
import { describe, expect, test } from "vitest";
import {
  classifyMessage,
  looksLikeExpense,
  type BotIntent,
} from "@/modules/reminders/channels/telegram/classify";

const task = (text: string, forced = false): BotIntent => ({
  kind: "capture",
  capture: "task",
  text,
  forced,
});
const expense = (text: string, forced = false): BotIntent => ({
  kind: "capture",
  capture: "expense",
  text,
  forced,
});

describe("implicit capture: an expense only with decimals or a currency mark", () => {
  const cases: [string, "task" | "expense"][] = [
    // The spec's examples.
    ["pilas mañana", "task"],
    ["12.50 café", "expense"],
    ["pilas 3", "task"],
    ["café 12", "task"],
    // Decimals, either separator, either side.
    ["café 12,50", "expense"],
    ["12,5 café", "expense"],
    ["taxi 8.00", "expense"],
    ["12.50", "expense"],
    // Currency marks make a bare integer an expense.
    ["S/ 12 taxi", "expense"],
    ["s/12 taxi", "expense"],
    ["$5 café", "expense"],
    ["USD 95 claude", "expense"],
    ["taxi 15 soles", "expense"],
    ["claude 20 dolares", "expense"],
    // Numbers in the middle, three decimals, prose: not an amount.
    ["comprar 3 pilas", "task"],
    ["comprar 1,250 pilas", "task"],
    ["ideas para el viaje", "task"],
    ["llamar al banco mañana a las 10am", "task"],
    // Nothing numeric.
    ["café", "task"],
    ["hola", "task"],
  ];

  test.each(cases)("%s → %s", (text, expected) => {
    expect(classifyMessage(text)).toEqual(expected === "task" ? task(text) : expense(text));
  });

  test("looksLikeExpense agrees with the table", () => {
    const wrong = cases.filter(
      ([text, expected]) => looksLikeExpense(text) !== (expected === "expense"),
    );
    expect(wrong).toEqual([]);
  });

  test("whitespace around the text is trimmed", () => {
    expect(classifyMessage("  pilas mañana \n")).toEqual(task("pilas mañana"));
  });
});

describe("commands", () => {
  test("/start, /ayuda (and /help) and /hoy", () => {
    expect(classifyMessage("/start")).toEqual({ kind: "start" });
    expect(classifyMessage("/ayuda")).toEqual({ kind: "help" });
    expect(classifyMessage("/help")).toEqual({ kind: "help" });
    expect(classifyMessage("/hoy")).toEqual({ kind: "today" });
  });

  test("the command is case-insensitive and may carry the bot's name", () => {
    expect(classifyMessage("/HOY")).toEqual({ kind: "today" });
    expect(classifyMessage("/hoy@brahua_bot")).toEqual({ kind: "today" });
    expect(classifyMessage("/gasto@brahua_bot café 12")).toEqual(expense("café 12", true));
  });

  test("/tarea and /gasto force the kind, whatever the text looks like", () => {
    expect(classifyMessage("/tarea pilas mañana")).toEqual(task("pilas mañana", true));
    expect(classifyMessage("/tarea 12.50 café")).toEqual(task("12.50 café", true));
    expect(classifyMessage("/gasto café 12")).toEqual(expense("café 12", true));
    expect(classifyMessage("/gasto pilas mañana")).toEqual(expense("pilas mañana", true));
    // The rest keeps its inner line breaks and spacing for the parser to normalize.
    expect(classifyMessage("/tarea  uno\ndos")).toEqual(task("uno\ndos", true));
  });

  test("/tarea and /gasto with nothing after them ask for it", () => {
    expect(classifyMessage("/tarea")).toEqual({ kind: "usage", capture: "task" });
    expect(classifyMessage("/gasto   ")).toEqual({ kind: "usage", capture: "expense" });
  });

  test("any other /word is an unknown command and is never captured", () => {
    for (const text of [
      "/borrar todo",
      "/",
      "/12.50 café",
      "/start2",
      "//tarea pilas",
      "/Tarea2 x",
    ]) {
      expect(classifyMessage(text)).toEqual({ kind: "unknown_command" });
    }
  });

  test("a slash inside the text is just text", () => {
    expect(classifyMessage("comprar pan/leche")).toEqual(task("comprar pan/leche"));
  });

  test("empty text is ignored", () => {
    expect(classifyMessage("")).toEqual({ kind: "ignore" });
    expect(classifyMessage(" \n\t ")).toEqual({ kind: "ignore" });
  });
});
