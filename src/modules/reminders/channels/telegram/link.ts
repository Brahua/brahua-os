// Linking the owner's Telegram chat (SPEC-reminders "Vinculación"). The owner taps "Conectar" in
// Ajustes, gets `t.me/<bot>?start=<code>`, and the webhook turns `/start <code>` into the link.
//
// - The code: 8 characters from a 32-letter alphabet (`crypto.randomBytes`), valid 10 minutes,
//   one use. Only its SHA-256 is stored.
// - One live code: issuing a new one (and disconnecting) invalidates the others.
// - Guessing is throttled WITHOUT touching the codes (a stranger must not be able to switch the
//   owner's linking off): 5 wrong codes from one chat in an hour and that chat is ignored; 30
//   wrong codes from anyone in 10 minutes and every attempt is answered "invalid". A malformed
//   code counts as an attempt of its chat.
// - A chat that is already linked ignores `/start` from anyone else: nothing is consumed.
//
// Issuing and redeeming run in a transaction that first locks the settings row (`FOR UPDATE`), so
// the two never interleave and a code can't be used twice. No advisory lock is needed: the row
// lock is the only lock taken, and it is the first.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { reminderSettings, telegramLinkAttempts, telegramLinkCodes } from "../../db/schema";
import {
  LINK_CHAT_WINDOW_MS,
  LINK_CODE_LENGTH,
  LINK_CODE_TTL_MS,
  LINK_GLOBAL_MAX_ATTEMPTS,
  LINK_GLOBAL_WINDOW_MS,
  LINK_MAX_FAILED_ATTEMPTS,
} from "../../reminders-constants";
import { ensureSettings } from "../../settings";

/** 24 letters (no I, no O) and 8 digits (no 0, no 1): 32 symbols, so a byte maps without bias. */
export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CODE_SHAPE = new RegExp(`^[${LINK_CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`);

/** A fresh random code. `random` is injectable for tests. */
export function generateLinkCode(random: (size: number) => Uint8Array = randomBytes): string {
  const bytes = random(LINK_CODE_LENGTH);
  let code = "";
  // 256 is a multiple of 32: `byte % 32` is uniform.
  for (let index = 0; index < LINK_CODE_LENGTH; index++) {
    code += LINK_CODE_ALPHABET[bytes[index] % LINK_CODE_ALPHABET.length];
  }
  return code;
}

/** What the owner typed or Telegram delivered, as a code; null when it can't be one. */
export function normalizeLinkCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return CODE_SHAPE.test(code) ? code : null;
}

export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** `/start CODE` (or `/start@bot CODE`) → CODE as written; null for anything else. */
export function parseStartCommand(text: string): string | null {
  const match = /^\/start(?:@\w+)?\s+(\S+)\s*$/i.exec(text.trim());
  return match ? match[1] : null;
}

export type IssuedCode = { code: string; expiresAt: Date };

/** A Drizzle transaction handle. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Locks the settings row (it must exist: `ensureSettings` first) inside a transaction. */
async function lockSettings(tx: Tx) {
  const [row] = await tx
    .select()
    .from(reminderSettings)
    .where(eq(reminderSettings.id, true))
    .for("update");
  return row;
}

/**
 * Issues a new code and invalidates the live ones. Refuses (null) when a chat is already linked:
 * the owner disconnects first.
 */
export async function issueLinkCode(db: Database, now: Date): Promise<IssuedCode | null> {
  await ensureSettings(db);
  return db.transaction(async (tx) => {
    const settings = await lockSettings(tx);
    if (settings.telegramChatId !== null) return null;
    await tx.update(telegramLinkCodes).set({ usedAt: now }).where(isNull(telegramLinkCodes.usedAt));
    const code = generateLinkCode();
    const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
    await tx.insert(telegramLinkCodes).values({ codeHash: hashLinkCode(code), expiresAt });
    return { code, expiresAt };
  });
}

export type RedeemResult = "linked" | "invalid" | "already-linked";

/**
 * The redemption itself, for a caller that already opened a transaction (the webhook claims the
 * Telegram `update_id` in the same one, so a failure rolls both back and Telegram's retry works).
 * `ensureSettings` must have run before the transaction.
 */
export async function redeemLinkCodeIn(
  tx: Tx,
  input: { code: string; chatId: number; now: Date },
): Promise<RedeemResult> {
  const { chatId, now } = input;
  const settings = await lockSettings(tx);
  if (settings.telegramChatId !== null) return "already-linked";

  // Throttle first, and never through the codes: a chat past its limit is ignored, and past the
  // global rate everything is answered "invalid"; neither closes the owner's live code.
  const [{ chat, global }] = await tx
    .select({
      chat: sql<number>`count(*) filter (where ${telegramLinkAttempts.chatId} = ${chatId} and ${telegramLinkAttempts.createdAt} > ${new Date(now.getTime() - LINK_CHAT_WINDOW_MS).toISOString()}::timestamptz)::int`,
      global: sql<number>`count(*) filter (where ${telegramLinkAttempts.createdAt} > ${new Date(now.getTime() - LINK_GLOBAL_WINDOW_MS).toISOString()}::timestamptz)::int`,
    })
    .from(telegramLinkAttempts);
  if (chat >= LINK_MAX_FAILED_ATTEMPTS || global >= LINK_GLOBAL_MAX_ATTEMPTS) return "invalid";

  const code = normalizeLinkCode(input.code);
  const used = code
    ? await tx
        .update(telegramLinkCodes)
        .set({ usedAt: now })
        .where(
          and(
            eq(telegramLinkCodes.codeHash, hashLinkCode(code)),
            isNull(telegramLinkCodes.usedAt),
            gt(telegramLinkCodes.expiresAt, now),
          ),
        )
        .returning({ id: telegramLinkCodes.id })
    : [];

  if (used.length === 0) {
    // A wrong (or malformed) guess counts against its chat, not against the codes.
    await tx.insert(telegramLinkAttempts).values({ chatId, createdAt: now });
    return "invalid";
  }

  await tx
    .update(reminderSettings)
    .set({ telegramChatId: chatId, linkedAt: now, telegramBlockedAt: null })
    .where(eq(reminderSettings.id, true));
  return "linked";
}

/**
 * Uses a code to link `chatId`. "invalid" covers a wrong, expired, used or malformed code (and
 * counts as an attempt of that chat, and a chat or a rate over the limit is "invalid" too, with
 * the codes untouched); "already-linked" leaves the code untouched.
 */
export async function redeemLinkCode(
  db: Database,
  input: { code: string; chatId: number; now: Date },
): Promise<RedeemResult> {
  await ensureSettings(db);
  return db.transaction((tx) => redeemLinkCodeIn(tx, input));
}
