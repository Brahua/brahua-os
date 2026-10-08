// The reminder source of `finance` (SPEC-reminders "Avisos" and "Contratos → Con `finance`").
// Registered by the composition root src/lib/reminder-sources.ts (imported by name there);
// `reminders` never imports it and this file imports nothing of `reminders` but its contracts.
//
// - `payment_eve`: the day before a payment is due, at the briefing's time. Pending periods only:
//   a paid, skipped, archived or deleted payment never reminds (`getUpcomingPayments`).
//   dedupe key `payment_eve:<recurringId>:<dueOn>`.
// - `payment_followup`: 3 days after the due date, at the briefing's time, if it is STILL pending:
//   one single reminder per payment and due date (`payment_followup:<recurringId>:<dueOn>`). Its
//   window is 2 hours, so a payment that stays pending later gets no more: never a drumbeat.
// - the briefing's facts: the payments due that day (with their formatted amount; the briefing
//   decides whether the channel shows it).
//
// A window can cross midnight (a briefing at 23:00 makes the eve of a payment due today still open
// at 00:30), so the candidates are asked by slot, not by day: the engine decides by `dueAt`.
import "server-only";
import { getDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import {
  addDaysToKey,
  paymentEveSlot,
  paymentEveText,
  paymentFollowupSlot,
  paymentFollowupText,
  windowState,
  type PaymentFact,
  type ReminderCandidate,
  type ReminderSource,
} from "@/modules/reminders/contracts";
import { selectUpcomingPayments, type UpcomingPayment } from "./contracts";
import { formatMoney } from "./money";

const factOf = (payment: UpcomingPayment): PaymentFact => ({
  name: payment.name,
  amountLabel:
    payment.amountCents === null ? null : formatMoney(payment.amountCents, payment.currency),
});

export const financeReminderSource: ReminderSource = {
  id: "finance",

  async candidates(ctx) {
    const { today, now } = ctx;
    const db = getDb();
    // The eve of what is due today or tomorrow; the follow-up of what was due 3 or 4 days ago.
    const [eves, followups] = await Promise.all([
      selectUpcomingPayments(db, today, addDaysToKey(today, 1), today),
      selectUpcomingPayments(db, addDaysToKey(today, -4), addDaysToKey(today, -3), today),
    ]);
    const out: ReminderCandidate[] = [];

    for (const payment of eves) {
      const dueAt = paymentEveSlot(payment.dueOn, ctx.times.briefing);
      // A window already closed is not worth a row (a payment added this morning for today).
      if (windowState(dueAt, now) === "expired") continue;
      out.push({
        kind: "payment_eve",
        dedupeKey: `payment_eve:${payment.recurringId}:${payment.dueOn}`,
        dueAt,
        build: async ({ showAmounts }) =>
          paymentEveText(factOf(payment), {
            showAmounts,
            day: payment.dueOn === today ? "today" : "tomorrow",
          }),
      });
    }

    for (const payment of followups) {
      const dueAt = paymentFollowupSlot(payment.dueOn, ctx.times.briefing);
      if (windowState(dueAt, now) === "expired") continue;
      out.push({
        kind: "payment_followup",
        dedupeKey: `payment_followup:${payment.recurringId}:${payment.dueOn}`,
        dueAt,
        build: async () => paymentFollowupText(payment, payment.dueOn),
      });
    }
    return out;
  },

  async briefingFacts(at) {
    const day = ownerDateKey(at);
    const due = await selectUpcomingPayments(getDb(), day, day, day);
    return { paymentsDueToday: due.map(factOf) };
  },
};
