// Addendum E5 of `finance-email`: which recurring payment a bank email is. Pure.
import { describe, expect, test } from "vitest";
import {
  matchRecurring,
  normalizeForMatch,
  type MatchCandidate,
} from "@/modules/finance/email/recurring-match";

const candidate = (
  over: Partial<MatchCandidate> & { id: string; name: string },
): MatchCandidate => ({
  amountCents: 5000,
  currency: "PEN",
  aliases: [],
  ...over,
});
const NETFLIX = candidate({ id: "netflix", name: "Netflix" });
const SPOTIFY = candidate({ id: "spotify", name: "Spotify", amountCents: 3290 });

const email = (merchant: string, amountCents = 5000, currency: "PEN" | "USD" = "PEN") => ({
  merchant,
  amountCents,
  currency,
});

describe("normalizeForMatch", () => {
  test.each([
    ["EBN*SPOTIFY", "ebn spotify"],
    ["  Música   Ñandú ", "musica nandu"],
    ["OPENAI *CHATGPT SUBSCR.", "openai chatgpt subscr"],
    ["PLIN-KATITA", "plin katita"],
    ["", ""],
  ])("%j → %j", (raw, normalized) => {
    expect(normalizeForMatch(raw)).toBe(normalized);
  });
});

describe("matchRecurring", () => {
  test("name and amount", () => {
    expect(matchRecurring(email("NETFLIX.COM"), [NETFLIX, SPOTIFY])).toEqual({
      id: "netflix",
      rule: "nameAndAmount",
    });
  });

  test("a variable payment matches by name at any amount", () => {
    const variable = candidate({ id: "luz", name: "Luz del Sur", amountCents: null });
    expect(matchRecurring(email("LUZ DEL SUR SA", 12345), [variable])).toEqual({
      id: "luz",
      rule: "nameAndAmount",
    });
  });

  test("the name alone, with another amount, is the weakest rule (still offered)", () => {
    expect(matchRecurring(email("NETFLIX.COM", 6000), [NETFLIX])).toEqual({
      id: "netflix",
      rule: "nameOnly",
    });
  });

  test("every word of the name has to be in the merchant", () => {
    const named = candidate({ id: "gym", name: "Smart Fit Gimnasio" });
    expect(matchRecurring(email("SMART FIT"), [named])).toBeNull();
    expect(matchRecurring(email("SMARTFIT GIMNASIO SMART FIT"), [named])).not.toBeNull();
  });

  test("a learned merchant wins over a name, at any amount", () => {
    const music = candidate({ id: "music", name: "Música", aliases: ["ebn spotify"] });
    expect(matchRecurring(email("EBN*SPOTIFY", 1), [music, NETFLIX])).toEqual({
      id: "music",
      rule: "alias",
    });
  });

  test("an alias beats a name match of another payment", () => {
    const music = candidate({ id: "music", name: "Música", aliases: ["netflix com"] });
    expect(matchRecurring(email("NETFLIX.COM"), [NETFLIX, music])).toEqual({
      id: "music",
      rule: "alias",
    });
  });

  test("two as likely as each other: none (never guess between two)", () => {
    const twin = candidate({ id: "netflix-2", name: "Netflix Premium" });
    const other = candidate({ id: "netflix-1", name: "Netflix" });
    expect(matchRecurring(email("NETFLIX PREMIUM"), [other, twin])).toEqual({
      id: "netflix-2",
      rule: "nameAndAmount",
    });
    const sameName = candidate({ id: "netflix-3", name: "Netflix" });
    expect(matchRecurring(email("NETFLIX.COM"), [other, sameName])).toBeNull();
  });

  test("another currency never matches, not even by alias", () => {
    const usd = candidate({
      id: "chatgpt",
      name: "ChatGPT",
      currency: "USD",
      aliases: ["openai chatgpt"],
    });
    expect(matchRecurring(email("OPENAI CHATGPT", 5000, "PEN"), [usd])).toBeNull();
    expect(matchRecurring(email("OPENAI CHATGPT", 5000, "USD"), [usd])).toEqual({
      id: "chatgpt",
      rule: "alias",
    });
  });

  test("words shorter than 3 letters identify nothing", () => {
    const short = candidate({ id: "x", name: "Mi" });
    expect(matchRecurring(email("MI TIENDA"), [short])).toBeNull();
  });

  test("an empty merchant matches nothing", () => {
    expect(matchRecurring(email("***"), [NETFLIX])).toBeNull();
  });
});
