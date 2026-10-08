// reminders → the pure part of the Telegram link code (generation, shape, hash, /start parsing).
// Redeeming against the database is in tests/integration/reminders-link.test.ts.
import { describe, expect, test } from "vitest";
import {
  generateLinkCode,
  hashLinkCode,
  LINK_CODE_ALPHABET,
  normalizeLinkCode,
  parseStartCommand,
} from "@/modules/reminders/channels/telegram/link";
import { LINK_CODE_LENGTH } from "@/modules/reminders/reminders-constants";

describe("generateLinkCode", () => {
  test("is 8 characters from the 32-symbol alphabet", () => {
    expect(LINK_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(LINK_CODE_ALPHABET).size).toBe(32);
    for (let index = 0; index < 200; index++) {
      const code = generateLinkCode();
      expect(code).toHaveLength(LINK_CODE_LENGTH);
      expect([...code].every((char) => LINK_CODE_ALPHABET.includes(char))).toBe(true);
    }
  });

  test("never has the look-alikes I, O, 0 or 1", () => {
    expect(LINK_CODE_ALPHABET).not.toMatch(/[IO01]/);
  });

  test("maps every byte uniformly (256 is a multiple of 32): byte % 32 picks the symbol", () => {
    const bytes = Uint8Array.from([0, 1, 31, 32, 63, 64, 255, 128]);
    const code = generateLinkCode(() => bytes);
    expect(code).toBe(
      [0, 1, 31, 0, 31, 0, 31, 0].map((index) => LINK_CODE_ALPHABET[index]).join(""),
    );
  });

  test("two codes differ (it is random)", () => {
    expect(new Set(Array.from({ length: 50 }, () => generateLinkCode())).size).toBe(50);
  });
});

describe("normalizeLinkCode", () => {
  test("trims and upper-cases a valid code", () => {
    expect(normalizeLinkCode("  abcd2345 ")).toBe("ABCD2345");
  });

  test.each(["", "ABC", "ABCD234", "ABCD23456", "ABCD234I", "ABCD2340", "abcd 2345", "ÁBCD2345"])(
    "rejects %j",
    (raw) => {
      expect(normalizeLinkCode(raw)).toBeNull();
    },
  );
});

describe("hashLinkCode", () => {
  test("is a SHA-256 hex digest, never the code", () => {
    const hash = hashLinkCode("ABCD2345");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("ABCD2345");
    expect(hashLinkCode("ABCD2345")).toBe(hash);
    expect(hashLinkCode("ABCD2346")).not.toBe(hash);
  });
});

describe("parseStartCommand", () => {
  test("reads the code after /start", () => {
    expect(parseStartCommand("/start ABCD2345")).toBe("ABCD2345");
    expect(parseStartCommand("  /start   ABCD2345  ")).toBe("ABCD2345");
    expect(parseStartCommand("/START abcd2345")).toBe("abcd2345");
    expect(parseStartCommand("/start@brahua_bot ABCD2345")).toBe("ABCD2345");
  });

  test("is null for anything else", () => {
    expect(parseStartCommand("/start")).toBeNull();
    expect(parseStartCommand("/start a b")).toBeNull();
    expect(parseStartCommand("start ABCD2345")).toBeNull();
    expect(parseStartCommand("hola /start ABCD2345")).toBeNull();
    expect(parseStartCommand("/ayuda")).toBeNull();
  });
});
