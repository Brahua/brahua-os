// @vitest-environment node
// R1.2 of `reminders`: linking the Telegram chat with a one-use code, against Postgres: valid,
// expired, reused and malformed codes, the per-chat and global throttles (which never close the
// owner's live code), a chat that is already linked, and two chats racing for the same code.
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import {
  hashLinkCode,
  issueLinkCode,
  redeemLinkCode,
} from "@/modules/reminders/channels/telegram/link";
import {
  reminderSettings,
  telegramLinkAttempts,
  telegramLinkCodes,
} from "@/modules/reminders/db/schema";
import {
  LINK_CHAT_WINDOW_MS,
  LINK_CODE_TTL_MS,
  LINK_GLOBAL_MAX_ATTEMPTS,
  LINK_GLOBAL_WINDOW_MS,
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
    expect(row.usedAt).toBeNull();
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
    expect(row.usedAt).toBeNull();
  });
});

const attempts = () => testDb.select().from(telegramLinkAttempts);
const minutes = (value: number) => value * 60_000;

describe("wrong guesses are throttled per chat and never close the owner's code", () => {
  test(`a stranger's ${LINK_MAX_FAILED_ATTEMPTS}+ wrong codes do NOT close the owner's live code`, async () => {
    const { code } = await issued();
    for (let attempt = 0; attempt < LINK_MAX_FAILED_ATTEMPTS + 3; attempt++) {
      expect(await redeem("ABCDEFGH", OTHER_CHAT)).toBe("invalid");
    }
    // The code is intact...
    expect((await codes())[0].usedAt).toBeNull();
    // ...and the owner's chat (another chat) links with it.
    expect(await redeem(code, CHAT)).toBe("linked");
  });

  test(`after ${LINK_MAX_FAILED_ATTEMPTS} wrong codes that chat is ignored, even with the right code`, async () => {
    const { code } = await issued();
    for (let attempt = 0; attempt < LINK_MAX_FAILED_ATTEMPTS; attempt++) {
      expect(await redeem("ABCDEFGH", OTHER_CHAT)).toBe("invalid");
    }
    expect(await attempts()).toHaveLength(LINK_MAX_FAILED_ATTEMPTS);
    // Past the limit the right code is refused for that chat, and nothing more is recorded.
    expect(await redeem(code, OTHER_CHAT)).toBe("invalid");
    expect(await attempts()).toHaveLength(LINK_MAX_FAILED_ATTEMPTS);
    expect((await settings()).telegramChatId).toBeNull();
    expect((await codes())[0].usedAt).toBeNull();
    // Another chat is not affected (positive control).
    expect(await redeem(code, CHAT)).toBe("linked");
  });

  test("an hour later that chat is heard again", async () => {
    await issued();
    for (let attempt = 0; attempt < LINK_MAX_FAILED_ATTEMPTS; attempt++) {
      await redeem("ABCDEFGH", OTHER_CHAT);
    }
    const later = new Date(NOW.getTime() + LINK_CHAT_WINDOW_MS + 1000);
    // The code expired meanwhile: a fresh one, issued at that moment, works for that chat.
    const fresh = await issued(later);
    expect(await redeem(fresh.code, OTHER_CHAT, later)).toBe("linked");
  });

  test("a malformed code counts as an attempt of its chat", async () => {
    await issued();
    for (const raw of ["", "short", "ABCD2345X", "ABCD2340", "ÁÉÍÓÚ"]) {
      expect(await redeem(raw, OTHER_CHAT)).toBe("invalid");
    }
    expect((await attempts()).map((row) => row.chatId)).toEqual(
      Array(LINK_MAX_FAILED_ATTEMPTS).fill(OTHER_CHAT),
    );
  });

  test("four wrong codes still leave the chat able to link (positive control)", async () => {
    const { code } = await issued();
    for (let attempt = 1; attempt < LINK_MAX_FAILED_ATTEMPTS; attempt++) {
      await redeem("ABCDEFGH");
    }
    expect(await redeem(code)).toBe("linked");
  });

  test(`a global limit: ${LINK_GLOBAL_MAX_ATTEMPTS} wrong codes from many chats in 10 minutes → everything is "invalid", codes untouched`, async () => {
    const { code } = await issued();
    // 30 chats, one wrong code each: no chat is over its own limit.
    await testDb.insert(telegramLinkAttempts).values(
      Array.from({ length: LINK_GLOBAL_MAX_ATTEMPTS }, (_, index) => ({
        chatId: 6_000_000_000 + index,
        createdAt: new Date(NOW.getTime() - minutes(5)),
      })),
    );
    // The owner's chat, with the right code, is answered "invalid" while the rate is over...
    expect(await redeem(code, CHAT)).toBe("invalid");
    expect((await settings()).telegramChatId).toBeNull();
    // ...the code is intact (nobody closed it)...
    expect((await codes())[0].usedAt).toBeNull();
    // ...and once the attempts have left the window it links (positive control, with a fresh code
    // because the first one expired meanwhile).
    const later = new Date(NOW.getTime() + LINK_GLOBAL_WINDOW_MS + 1000);
    const fresh = await issued(later);
    expect(await redeem(fresh.code, CHAT, later)).toBe("linked");
  });

  test("one attempt below the global limit does not block", async () => {
    const { code } = await issued();
    await testDb.insert(telegramLinkAttempts).values(
      Array.from({ length: LINK_GLOBAL_MAX_ATTEMPTS - 1 }, (_, index) => ({
        chatId: 6_000_000_000 + index,
        createdAt: new Date(NOW.getTime() - minutes(5)),
      })),
    );
    expect(await redeem(code, CHAT)).toBe("linked");
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

  test("a late 403 about chat A, after chat B was linked, does not touch B or the codes", async () => {
    // B is linked now; a tick that still saw A gets A's 403 and asks to disconnect A.
    await getSettings(testDb);
    await testDb
      .update(reminderSettings)
      .set({ telegramChatId: OTHER_CHAT, linkedAt: NOW })
      .where(eq(reminderSettings.id, true));
    await testDb.insert(telegramLinkCodes).values({
      codeHash: hashLinkCode("ZZZZ2222"),
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    expect(await disconnectTelegram(testDb, "blocked", NOW, CHAT)).toBe(false);
    const row = await settings();
    expect(row).toMatchObject({ telegramChatId: OTHER_CHAT, telegramBlockedAt: null });
    expect((await codes())[0].usedAt).toBeNull();

    // Positive control: the same call for the chat that IS linked does disconnect it.
    expect(await disconnectTelegram(testDb, "blocked", NOW, OTHER_CHAT)).toBe(true);
    expect(await settings()).toMatchObject({ telegramChatId: null, telegramBlockedAt: NOW });
    expect((await codes())[0].usedAt).toEqual(NOW);
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
