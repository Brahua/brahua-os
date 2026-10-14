// Which recurring payment a bank email is (SPEC-finance-email, addendum E5). Pure: the data comes in,
// the answer goes out. A wrong guess only costs a "No es ese" (the owner confirms with a touch), but
// never guessing between two is better than guessing wrong, so a tie answers nothing.
import type { Currency } from "../finance-constants";

/** What a recurring payment offers to be recognized by. */
export type MatchCandidate = {
  id: string;
  name: string;
  /** Null: a variable amount (any amount is the expected one). */
  amountCents: number | null;
  currency: Currency;
  /** The merchants it remembers, already normalized (`normalizeForMatch`). */
  aliases: readonly string[];
};

/** `alias`: a merchant it remembers; `nameAndAmount`: its words and its amount; `nameOnly`: its words. */
export type MatchRule = "alias" | "nameAndAmount" | "nameOnly";

const RANK: Record<MatchRule, number> = { alias: 3, nameAndAmount: 2, nameOnly: 1 };

/** Lowercase, no accents, letters and digits only, single spaces: «EBN*SPOTIFY» → «ebn spotify». */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The words of a payment's name that can identify it (3 letters or more). */
function nameWords(name: string): string[] {
  return normalizeForMatch(name)
    .split(" ")
    .filter((word) => word.length >= 3);
}

export type MatchInput = { merchant: string; amountCents: number; currency: Currency };

export type Match = { id: string; rule: MatchRule };

/**
 * The payment this email is, or null (no candidate, or two as likely as each other). At the same rule
 * the one whose name says more (more words, «Netflix Premium» over «Netflix») wins; if that does not
 * separate them either, none.
 */
export function matchRecurring(
  input: MatchInput,
  candidates: readonly MatchCandidate[],
): Match | null {
  const merchant = normalizeForMatch(input.merchant);
  if (merchant === "") return null;
  let best: (Match & { specificity: number })[] = [];
  let bestScore = 0;
  for (const candidate of candidates) {
    // A payment in another currency is never this one.
    if (candidate.currency !== input.currency) continue;
    const rule = ruleOf(merchant, input.amountCents, candidate);
    if (!rule) continue;
    // The rule first, then how many words of the name matched.
    const specificity = nameWords(candidate.name).length;
    const score = RANK[rule] * 100 + specificity;
    if (score > bestScore) {
      bestScore = score;
      best = [{ id: candidate.id, rule, specificity }];
    } else if (score === bestScore) {
      best.push({ id: candidate.id, rule, specificity });
    }
  }
  return best.length === 1 ? { id: best[0].id, rule: best[0].rule } : null;
}

function ruleOf(
  merchant: string,
  amountCents: number,
  candidate: MatchCandidate,
): MatchRule | null {
  if (candidate.aliases.includes(merchant)) return "alias";
  const words = nameWords(candidate.name);
  if (words.length === 0 || !words.every((word) => merchant.includes(word))) return null;
  return candidate.amountCents === null || candidate.amountCents === amountCents
    ? "nameAndAmount"
    : "nameOnly";
}
