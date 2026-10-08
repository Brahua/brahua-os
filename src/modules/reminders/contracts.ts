// What `reminders` offers other modules (SPEC-reminders "Motor de avisos" y "Contratos"):
//
// 1. Reminder sources. `tasks`, `habits` and `finance` implement a ReminderSource and import ONLY
//    this file (ESLint enforces it: eslint.config.mjs). `reminders` never imports them: the
//    composition root `src/lib/reminder-sources.ts` imports each source BY NAME and registers it in
//    `ensureReminderSources()`, which the tick endpoint calls first. Never a side-effect-only
//    `import "…"`: package.json declares every JS module free of side effects, so the bundler
//    would drop it (same rule as `progress-sources`). Registering is idempotent by id.
//
// 2. ReminderChannel: how a message leaves the app. The engine knows only this interface;
//    Telegram implements it in R1, push web in R5.
//
// The types are plain data (this file imports `server-only` for the registry, nothing else), so a
// source file stays easy to test.
import "server-only";
import type { BriefingFacts } from "./messages";
import type { ChannelId, ReminderKind } from "./reminders-constants";

export type { ChannelId, ReminderKind } from "./reminders-constants";
export type { BriefingFacts, PaymentFact } from "./messages";

// R2: what a source needs to decide and to speak, so `tasks`, `habits` and `finance` import only
// this file. The slots are pure (Lima by arithmetic), the sentences live in messages.ts (one place
// for the forbidden-words test).
export {
  addDaysToKey,
  briefingSlot,
  eveningReviewSlot,
  limaDayOf,
  limaInstant,
  paymentEveSlot,
  paymentFollowupSlot,
  windowState,
} from "./slots";
export { eveningReviewText, paymentEveText, paymentFollowupText } from "./messages";

/** What a source is told when the engine asks for candidates. */
export type ReminderContext = {
  /** The instant of the tick. */
  now: Date;
  /** The owner's day (America/Lima) of `now`, YYYY-MM-DD. */
  today: string;
  /**
   * The owner's previous day, YYYY-MM-DD. A reminder's window is 2 h and can cross midnight (a
   * habit at 23:30 is still open at 00:30): sources return candidates for yesterday too, and the
   * engine decides by `dueAt` whether each is still open.
   */
  yesterday: string;
  /**
   * The owner's configured times, "HH:MM" in Lima: the briefing (and the payment reminders that
   * ride on it) and the evening review. A habit has its own time.
   */
  times: { briefing: string; evening: string };
};

/** How a message is built for one channel. */
export type BuildOptions = {
  channel: ChannelId;
  /** The channel's "show amounts" switch: when false, the text carries no amount. */
  showAmounts: boolean;
};

/** What a channel sends. `text` is plain; `dedupeKey` lets push replace instead of stack. */
export type ReminderMessage = {
  text: string;
  dedupeKey: string;
};

/**
 * One thing that may be worth saying, at one moment. A source returns candidates for the owner's
 * day (and for yesterday's, when a window crosses midnight); the engine decides if it is due,
 * claims its `dedupeKey` and only then calls `build`.
 */
export type ReminderCandidate = {
  kind: ReminderKind;
  /**
   * Unique per reminder: `briefing:2026-10-08`, `payment_eve:<paymentId>:<dueOn>`. Two ticks, or a
   * retry of the workflow, with the same key send once per channel.
   */
  dedupeKey: string;
  /** When it is due (an instant). It goes out from here until two hours later. */
  dueAt: Date;
  /**
   * The text for a channel, or null/empty when there is nothing to say (an empty day sends
   * nothing). Called after the claim: never put side effects here. Must not include text the
   * owner wrote nor amounts unless `showAmounts`.
   */
  build(options: BuildOptions): Promise<string | null>;
};

export type ReminderSource = {
  /** Stable id of the provider (e.g. "finance"). Registering the same id again replaces it. */
  id: string;
  candidates(context: ReminderContext): Promise<readonly ReminderCandidate[]>;
  /**
   * What this module knows about the owner's day that contains the instant `at`, for the morning
   * briefing (one message that spans modules: the briefing source of `reminders` merges every
   * source's facts). `at` is `now`, or `now` minus a day when a window crossed midnight. Called
   * after the briefing is claimed; read only. A source with nothing to say omits it.
   */
  briefingFacts?(at: Date): Promise<BriefingFacts>;
};

/** Why a channel could not send. */
export type ChannelSendResult =
  | { ok: true; messageId?: number }
  | {
      ok: false;
      /** A short code for `reminder_deliveries.error_code`: never a message from the service. */
      code: string;
      /** The destination is gone for good (Telegram 403: the bot was blocked): disconnect it. */
      unreachable?: boolean;
      /** The service asked to slow down (rate limit): no more sends through it in this tick. */
      backoff?: boolean;
    };

export type ReminderChannel = {
  id: ChannelId;
  send(message: ReminderMessage): Promise<ChannelSendResult>;
};

const sources = new Map<string, ReminderSource>();

/** Adds `source`, or replaces the one with its id. Returns a function that removes it. */
export function registerReminderSource(source: ReminderSource): () => void {
  sources.set(source.id, source);
  return () => {
    if (sources.get(source.id) === source) sources.delete(source.id);
  };
}

/** The registered sources, in registration order. */
export function listReminderSources(): ReminderSource[] {
  return [...sources.values()];
}
