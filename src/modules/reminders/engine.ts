// The reminder engine (SPEC-reminders "Un tick"). One call is one tick:
//   1. load the settings and decide the channels (none available → nothing to do);
//   2. ask every source for its candidates for `now` in Lima;
//   3. for each candidate whose switch is on and whose window `[dueAt, dueAt + 2 h)` is open:
//      claim its `dedupe_key` per channel, build the text, send, record sent/failed;
//      a window already closed is recorded as `skipped` (a briefing at 14:00 is noise);
//   4. a candidate never blocks another: an error is logged with `describeError` and the tick goes on.
// The engine knows sources and channels only through contracts.ts. Authentication is the caller's
// (the tick route), not the engine's.
import "server-only";
import type { Database } from "@/lib/db";
import { describeError } from "@/lib/describe-error";
import type {
  ReminderCandidate,
  ReminderChannel,
  ReminderContext,
  ReminderSource,
} from "./contracts";
import type { ReminderSettings } from "./db/schema";
import {
  claimDelivery,
  markFailed,
  markSent,
  markSkipped,
  recordSkipped,
  type DeliveryTarget,
} from "./deliveries";
import { logEvent } from "./log";
import { isKindEnabled, selectChannels, showAmountsFor } from "./policy";
import {
  EMPTY_ERROR_CODE,
  REMINDER_KINDS,
  WINDOW_EXPIRED_ERROR_CODE,
  type ChannelId,
  type ReminderKind,
} from "./reminders-constants";
import { countActivePushDevices, disconnectTelegram, getSettings } from "./settings";
import { addDaysToKey, limaDayOf, toHourMinute, windowState } from "./slots";

export type TickDeps = {
  db: Database;
  now: Date;
  sources: readonly ReminderSource[];
  /** The channels that can actually send right now (the route builds them from the environment). */
  channelsFor(settings: ReminderSettings): Partial<Record<ChannelId, ReminderChannel>>;
};

export type TickSummary = {
  /** `no-channel`: nothing is connected, so there was nothing to do. */
  status: "ok" | "no-channel";
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
};

/** Candidates from every source; a source that throws is logged and skipped. */
async function collectCandidates(
  sources: readonly ReminderSource[],
  context: ReminderContext,
): Promise<ReminderCandidate[]> {
  const all: ReminderCandidate[] = [];
  for (const source of sources) {
    try {
      all.push(...(await source.candidates(context)));
    } catch (error) {
      logEvent("error", "reminder_source_failed", { source: source.id, ...describeError(error) });
    }
  }
  return all;
}

export async function runTick(deps: TickDeps): Promise<TickSummary> {
  const { db, now } = deps;
  const settings = await getSettings(db);
  const available = deps.channelsFor(settings);
  const hasPushDevices = (await countActivePushDevices(db)) > 0;
  let active = selectChannels({
    deliveryChannel: settings.deliveryChannel,
    hasPushDevices,
    pushAvailable: available.push !== undefined,
    telegramConnected: settings.telegramChatId !== null,
  }).filter((id) => available[id] !== undefined);

  const summary: TickSummary = { status: "ok", candidates: 0, sent: 0, skipped: 0, failed: 0 };
  if (active.length === 0) return { ...summary, status: "no-channel" };

  const today = limaDayOf(now);
  const context: ReminderContext = {
    now,
    today,
    yesterday: addDaysToKey(today, -1),
    times: {
      briefing: toHourMinute(settings.briefingTime),
      evening: toHourMinute(settings.eveningTime),
    },
    enabled: Object.fromEntries(
      REMINDER_KINDS.map((kind) => [kind, isKindEnabled(settings, kind)]),
    ) as Record<ReminderKind, boolean>,
  };
  const candidates = await collectCandidates(deps.sources, context);
  summary.candidates = candidates.length;

  for (const candidate of candidates) {
    if (!isKindEnabled(settings, candidate.kind)) continue;
    const state = windowState(candidate.dueAt, now);
    if (state === "early") continue;

    // Snapshot: a channel that turns out unreachable leaves `active` for the next candidates.
    for (const channelId of [...active]) {
      const channel = available[channelId];
      if (!channel) continue;
      const target: DeliveryTarget = {
        kind: candidate.kind,
        channel: channelId,
        dedupeKey: candidate.dedupeKey,
        scheduledFor: candidate.dueAt,
      };
      try {
        if (state === "expired") {
          if (await recordSkipped(db, target, WINDOW_EXPIRED_ERROR_CODE)) summary.skipped++;
          continue;
        }
        const outcome = await deliverOne({ db, now, settings, candidate, channel, target });
        if (outcome.counter) summary[outcome.counter]++;
        if (outcome.unreachable) {
          active = active.filter((id) => id !== channelId);
          // Only if that chat is still the linked one: a late 403 of chat A must not unlink B.
          if (channelId === "telegram") {
            await disconnectTelegram(db, "blocked", now, settings.telegramChatId ?? undefined);
          }
        } else if (outcome.backoff) {
          // Rate limited: leave this channel alone for the rest of the tick (the next one retries).
          active = active.filter((id) => id !== channelId);
        }
      } catch (error) {
        // One candidate or channel never stops the rest.
        logEvent("error", "reminder_delivery_failed", {
          kind: candidate.kind,
          channel: channelId,
          ...describeError(error),
        });
        summary.failed++;
      }
    }
    if (active.length === 0) break;
  }
  return summary;
}

/** `counter: null`: another tick holds this reminder, so this one counts nothing. */
type DeliverOutcome = {
  counter: "sent" | "skipped" | "failed" | null;
  unreachable?: boolean;
  backoff?: boolean;
};

async function deliverOne(input: {
  db: Database;
  now: Date;
  settings: ReminderSettings;
  candidate: ReminderCandidate;
  channel: ReminderChannel;
  target: DeliveryTarget;
}): Promise<DeliverOutcome> {
  const { db, now, settings, candidate, channel, target } = input;
  // The claim: only the tick that gets the row goes on.
  const id = await claimDelivery(db, target);
  if (!id) return { counter: null };

  let text: string | null;
  try {
    text = await candidate.build({
      channel: channel.id,
      showAmounts: showAmountsFor(settings, channel.id),
    });
  } catch (error) {
    logEvent("error", "reminder_build_failed", { kind: candidate.kind, ...describeError(error) });
    await markFailed(db, id, "build_failed");
    return { counter: "failed" };
  }
  if (!text || text.trim().length === 0) {
    await markSkipped(db, id, EMPTY_ERROR_CODE);
    return { counter: "skipped" };
  }

  let result;
  try {
    result = await channel.send({ text, dedupeKey: candidate.dedupeKey });
  } catch (error) {
    logEvent("error", "reminder_send_threw", {
      kind: candidate.kind,
      channel: channel.id,
      ...describeError(error),
    });
    await markFailed(db, id, "send_threw");
    return { counter: "failed" };
  }
  if (result.ok) {
    await markSent(db, id, now, result.messageId);
    return { counter: "sent" };
  }
  await markFailed(db, id, result.code);
  logEvent("warn", "reminder_send_refused", {
    kind: candidate.kind,
    channel: channel.id,
    code: result.code,
  });
  return { counter: "failed", unreachable: result.unreachable, backoff: result.backoff };
}
