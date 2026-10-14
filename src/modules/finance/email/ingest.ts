// POST /api/finance/email-ingest (SPEC-finance-email): where the owner's Apps Script delivers the
// bank emails it found in Gmail. Order, from the lessons of `reminders`: the caller is authenticated
// BEFORE the body is read (no secret, wrong secret or an unconfigured server all answer a bare 404,
// so nothing says the endpoint exists) → size → JSON → shape (Zod) → relevance (known sender AND
// subject) → and only then write. Each email becomes one suggestion row keyed by its Gmail id with
// `INSERT … ON CONFLICT DO NOTHING`, so a retry, two overlapping runs or a re-sent batch change
// nothing. Only what the parser extracted is stored (never the body) and nothing here is logged but
// counts and an error class.
import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { describeError } from "@/lib/describe-error";
import {
  financeEmailSuggestions,
  financeSettings,
  type NewFinanceEmailSuggestion,
} from "../db/schema";
import {
  GMAIL_MESSAGE_ID,
  MAX_EMAIL_TEXT_LENGTH,
  MAX_INGEST_BODY_BYTES,
  MAX_MESSAGES_PER_BATCH,
  SUGGESTION_SUBJECT_MAX_LENGTH,
} from "./constants";
import { bearerToken, resolveIngestSecret, safeEqual } from "./env";
import { isOwnName } from "./own-names";
import { parseEmail } from "./parsers";
import type { EmailMessage } from "./types";

// Postgres refuses NUL in text: reject it at the door instead of failing on insert.
const noNul = (value: string) => !value.includes("\u0000");

const messageSchema = z.object({
  id: z.string().regex(GMAIL_MESSAGE_ID),
  from: z.string().min(3).max(320).refine(noNul),
  subject: z.string().max(500).refine(noNul),
  receivedAt: z.iso.datetime({ offset: true }),
  text: z.string().max(MAX_EMAIL_TEXT_LENGTH).refine(noNul),
  // The script reads Gmail's `Authentication-Results`: anything but "pass" is not verified.
  auth: z.enum(["pass", "fail", "none"]).default("none"),
});

export const ingestBodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES_PER_BATCH),
});

export type IngestSummary = {
  received: number;
  created: number;
  /** Already known by Gmail id: nothing changed. */
  duplicates: number;
  /** Known sender and subject that is not an expense (own accounts, card payments…). */
  ignored: number;
  /** Not a sender/subject this feature reads. */
  unknown: number;
  /** Stored as «No pude leerlo». */
  unreadable: number;
  /** A row that was «No pude leerlo» and is now read (the script re-sent it after a new rule). */
  reread: number;
  /** The database refused the row for good (SQLSTATE 22/23): skipped so the rest of the batch goes in. */
  rejected: number;
};

/** A data error (class 22) or an integrity error (class 23): retrying the same row can never work. */
function isPermanentRowError(error: unknown): boolean {
  let root: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    const next = (root as { cause?: unknown } | null)?.cause;
    if (!next || typeof next !== "object") break;
    root = next;
  }
  const code = (root as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^(22|23)/.test(code);
}

export type IngestDeps = {
  db: Database;
  env?: Record<string, string | undefined>;
};

const respond = (status: number, body?: unknown) =>
  body === undefined
    ? new Response(null, { status })
    : Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Reads the body up to `limit` bytes; null when it is bigger. */
async function readBounded(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Whether the request carries the owner's secret. An unconfigured server never authorizes. */
export function isIngestAuthorized(header: string | null, env?: IngestDeps["env"]): boolean {
  const resolved = resolveIngestSecret(env);
  if (!resolved.ok) return false;
  const token = bearerToken(header);
  return token !== null && safeEqual(token, resolved.secret);
}

export async function handleEmailIngest(request: Request, deps: IngestDeps): Promise<Response> {
  if (!isIngestAuthorized(request.headers.get("authorization"), deps.env)) return respond(404);

  const raw = await readBounded(request, MAX_INGEST_BODY_BYTES);
  if (raw === null) return respond(413);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return respond(400);
  }
  const parsed = ingestBodySchema.safeParse(json);
  if (!parsed.success) return respond(400);

  const summary: IngestSummary = {
    received: parsed.data.messages.length,
    created: 0,
    duplicates: 0,
    ignored: 0,
    unknown: 0,
    unreadable: 0,
    reread: 0,
    rejected: 0,
  };

  // «Mis nombres», read once and only when a transfer needs it.
  let ownNames: readonly string[] | null = null;
  const loadOwnNames = async () => {
    if (ownNames === null) {
      const [row] = await deps.db
        .select({ names: financeSettings.ownNames })
        .from(financeSettings)
        .limit(1);
      ownNames = row?.names ?? [];
    }
    return ownNames;
  };

  try {
    for (const item of parsed.data.messages) {
      const message: EmailMessage = {
        id: item.id,
        from: item.from,
        subject: item.subject.trim(),
        receivedAt: new Date(item.receivedAt),
        text: item.text,
        senderVerified: item.auth === "pass",
      };
      const outcome = parseEmail(message);
      if (outcome.type === "unknown") {
        summary.unknown += 1;
        continue;
      }
      if (outcome.type === "ignored") {
        summary.ignored += 1;
        continue;
      }
      // A transfer to the owner's own account is money moving, not spending.
      if (
        outcome.type === "reading" &&
        outcome.reading.kind === "transfer" &&
        isOwnName(outcome.reading.merchant, await loadOwnNames())
      ) {
        summary.ignored += 1;
        continue;
      }
      const base = {
        gmailMessageId: message.id,
        source: outcome.source,
        subject: message.subject.slice(0, SUGGESTION_SUBJECT_MAX_LENGTH),
        senderVerified: message.senderVerified,
      } satisfies Partial<NewFinanceEmailSuggestion>;
      const row: NewFinanceEmailSuggestion =
        outcome.type === "reading"
          ? {
              ...base,
              status: "pending",
              kind: outcome.reading.kind,
              amountCents: outcome.reading.amountCents,
              currency: outcome.reading.currency,
              merchant: outcome.reading.merchant,
              occurredOn: outcome.reading.occurredOn,
              cardLast4: outcome.reading.cardLast4,
            }
          : { ...base, status: "unreadable" };
      let inserted: { id: string; isNew: boolean }[];
      try {
        const insert = deps.db.insert(financeEmailSuggestions).values(row);
        // A re-sent email that was «No pude leerlo» and now reads (a new rule) becomes the suggestion;
        // anything already decided or already read stays as it is (the WHERE).
        inserted = await (
          outcome.type === "reading"
            ? insert.onConflictDoUpdate({
                target: financeEmailSuggestions.gmailMessageId,
                set: {
                  status: "pending",
                  kind: row.kind,
                  amountCents: row.amountCents,
                  currency: row.currency,
                  merchant: row.merchant,
                  occurredOn: row.occurredOn,
                  cardLast4: row.cardLast4,
                  source: row.source,
                },
                setWhere: eq(financeEmailSuggestions.status, "unreadable"),
              })
            : insert.onConflictDoNothing({ target: financeEmailSuggestions.gmailMessageId })
        ).returning({
          id: financeEmailSuggestions.id,
          // `xmax` is 0 for a row this statement inserted, not for one it updated.
          isNew: sql<boolean>`(xmax = 0)`,
        });
      } catch (error) {
        // One poisoned email must not stop the others (nor be retried forever): skip it, say so.
        if (!isPermanentRowError(error)) throw error;
        summary.rejected += 1;
        console.warn(
          JSON.stringify({ event: "finance_email_row_rejected", ...describeError(error) }),
        );
        continue;
      }
      if (inserted.length === 0) summary.duplicates += 1;
      else if (outcome.type === "reading") {
        if (inserted[0].isNew) summary.created += 1;
        else summary.reread += 1;
      } else summary.unreadable += 1;
    }
  } catch (error) {
    // The script treats anything but 2xx as "try again later": every insert is idempotent.
    console.error(
      JSON.stringify({ event: "finance_email_ingest_failed", ...describeError(error) }),
    );
    return respond(500, { ok: false });
  }
  console.info(JSON.stringify({ event: "finance_email_ingest", ...summary }));
  return respond(200, { ok: true, ...summary });
}
