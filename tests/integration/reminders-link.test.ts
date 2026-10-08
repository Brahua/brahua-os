// @vitest-environment node
// R1.2 of `reminders`: linking the Telegram chat with a one-use code, against Postgres: valid,
// expired, reused and malformed codes, the 5-failure limit, a chat that is already linked, and two
// chats racing for the same code.
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import {
  hashLinkCode,
  issueLinkCode,
  redeemLinkCode,
} from "@/modules/reminders/channels/telegram/link";
import { reminderSettings, telegramLinkCodes } from "@/modules/reminders/db/schema";
import {
  LINK_CODE_TTL_MS,
  LINK_MAX_FAILED_ATTEMPTS,
} from "@/modules/reminders/reminders-constants";
import { disconnectTelegram, getSettings } from "@/modules/reminders/settings";
import { testDb } from "./test-db";

const NOW = new Date("2026-10-08T12:00:00Z");
const CHAT = 5_000_000_001;
const OTHER_CHAT = 5_000_000_002;

const codes = () => testDb.select().from(telegramLinkCodes).orderBy(telegramLinkCodes.createdAt);
const settings = () => getSettings(testDb);
const redeem = (code: string, chatId = CHAT, now = NOW) =>
  redeemLinkCode(testDb, { code, chatId, now });

async function issued(now = NOW) {
  const result = await issueLinkCode(testDb, now);
  if (!result) throw new Error("no code issued");
  return result;
}

describe("issueLinkCode", () => {
  test("stores only the hash, valid for 10 minutes", async () => {
    const { code, expiresAt } = await issued();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(expiresAt).toEqual(new Date(NOW.getTime() + LINK_CODE_TTL_MS));
    const [row] = await codes();
    expect(row.codeHash).toBe(hashLinkCode(code));
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row).toMatchObject({ usedAt: null, failedAttempts: 0 });
  });

  test("a new code invalidates the live one: only one is ever live", async () => {
    const first = await issued();
    const second = await issued(new Date(NOW.getTime() + 1000));
    expect(await redeem(first.code)).toBe("invalid");
    expect(await redeem(second.code)).toBe("linked");
  });

  test("is refused while a chat is linked (disconnect first)", async () => {
    const { code } = await issued();
    expect(await redeem(code)).toBe("linked");
    expect(await issueLinkCode(testDb, NOW)).toBeNull();
    await disconnectTelegram(testDb, "owner", NOW);
    expect(await issueLinkCode(testDb, NOW)).not.toBeNull();
  });
});

describe("redeemLinkCode", () => {
  test("a valid code links the chat and is spent", async () => {
    const { code } = await issued();
    expect(await redeem(code)).toBe("linked");
    const row = await settings();
    expect(row.telegramChatId).toBe(CHAT);
    expect(row.linkedAt).toEqual(NOW);
    expect(row.telegramBlockedAt).toBeNull();
    expect((await codes())[0].usedAt).toEqual(NOW);
  });

  test("it is case-insensitive and tolerates spaces around it", async () => {
    const { code } = await issued();
    expect(await redeem(`  ${code.toLowerCase()} `)).toBe("linked");
  });

  test("a code can be used once: the second attempt is invalid", async () => {
    const { code } = await issued();
    expect(await redeem(code)).toBe("linked");
    await disconnectTelegram(testDb, "owner", NOW);
    expect(await redeem(code, OTHER_CHAT)).toBe("invalid");
    expect((await settings()).telegramChatId).toBeNull();
  });

  test("an expired code is invalid, one second before expiring it still works", async () => {
    const { code, expiresAt } = await issued();
    expect(await redeem(code, CHAT, expiresAt)).toBe("invalid");
    expect((await settings()).telegramChatId).toBeNull();
    // Positive control: the same code a second before it expires.
    const again = await issued();
    expect(await redeem(again.code, CHAT, new Date(again.expiresAt.getTime() - 1000))).toBe(
      "linked",
    );
  });

  test.each(["", "short", "ABCD2345X", "ABCD234I", "ABCD2340"])(
    "a malformed code (%j) is invalid",
    async (raw) => {
      await issued();
      expect(await redeem(raw)).toBe("invalid");
      expect((await settings()).telegramChatId).toBeNull();
    },
  );

  test("a wrong code of the right shape is invalid and links nothing", async () => {
    await issued();
    expect(await redeem("ABCDEFGH")).toBe("invalid");
    expect((await settings()).telegramChatId).toBeNull();
  });

  test("a chat that is already linked ignores a valid code from another and keeps it unspent", async () => {
    const first = await issued();
    expect(await redeem(first.code, CHAT)).toBe("linked");
    // A live code cannot exist while linked (issue is refused), so make one by raw insert.
    const stray = "ZZZZ2222";
    await testDb.insert(telegramLinkCodes).values({
      codeHash: hashLinkCode(stray),
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    expect(await redeem(stray, OTHER_CHAT)).toBe("already-linked");
    expect((await settings()).telegramChatId).toBe(CHAT);
    const [row] = await testDb
      .select()
      .from(telegramLinkCodes)
      .where(eq(telegramLinkCodes.codeHash, hashLinkCode(stray)));
    expect(row).toMatchObject({ usedAt: null, failedAttempts: 0 });
  });
});

describe("wrong guesses", () => {
  test(`after ${LINK_MAX_FAILED_ATTEMPTS} wrong codes the live code is closed, even for the right one`, async () => {
    const { code } = await issued();
    for (let attempt = 1; attempt < LINK_MAX_FAILED_ATTEMPTS; attempt++) {
      expect(await redeem("ABCDEFGH")).toBe("invalid");
      expect((await codes())[0]).toMatchObject({ failedAttempts: attempt, usedAt: null });
    }
    expect(await redeem("ABCDEFGH")).toBe("invalid");
    expect((await codes())[0]).toMatchObject({ failedAttempts: LINK_MAX_FAILED_ATTEMPTS });
    expect((await codes())[0].usedAt).not.toBeNull();
    // The right code no longer works...
    expect(await redeem(code)).toBe("invalid");
    expect((await settings()).telegramChatId).toBeNull();
    // ...and a new one does (positive control).
    const fresh = await issued(new Date(NOW.getTime() + 1000));
    expect(await redeem(fresh.code, CHAT, new Date(NOW.getTime() + 2000))).toBe("linked");
  });

  test("four wrong codes still leave the right one working (positive control)", async () => {
    const { code } = await issued();
    for (let attempt = 1; attempt < LINK_MAX_FAILED_ATTEMPTS; attempt++) await redeem("ABCDEFGH");
    expect(await redeem(code)).toBe("linked");
  });
});

describe("concurrency", () => {
  test("two chats racing for the same code: exactly one links", async () => {
    const { code } = await issued();
    const results = await Promise.all([redeem(code, CHAT), redeem(code, OTHER_CHAT)]);
    expect(results.filter((result) => result === "linked")).toHaveLength(1);
    expect(results.filter((result) => result !== "linked")).toHaveLength(1);
    const row = await settings();
    expect([CHAT, OTHER_CHAT]).toContain(row.telegramChatId);
  });

  test("disconnecting closes the live codes and clears the chat", async () => {
    const { code } = await issued();
    await testDb
      .update(reminderSettings)
      .set({ telegramChatId: CHAT, linkedAt: NOW })
      .where(eq(reminderSettings.id, true));
    await disconnectTelegram(testDb, "owner", NOW);
    const row = await settings();
    expect(row).toMatchObject({ telegramChatId: null, linkedAt: null, telegramBlockedAt: null });
    expect(await redeem(code)).toBe("invalid");
  });
});
