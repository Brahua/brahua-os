// POST /api/reminders/tick: one tick of the reminder engine (SPEC-reminders "Motor de avisos").
//
// Callers:
// - GitHub Actions (.github/workflows/reminders-tick.yml, every 15 minutes) with POST and
//   `Authorization: Bearer $REMINDERS_CRON_SECRET`.
// - Vercel Cron (vercel.json, once a day: the safety net if Actions does not run) with GET and
//   `Authorization: Bearer $CRON_SECRET`. Vercel Cron can only send GET and only that variable
//   name, so the endpoint accepts both methods and both secrets (the owner sets them to the same
//   value; see docs/HANDOFF.md "Cómo funciona reminders → R1").
//
// The caller is authenticated BEFORE anything else, in constant time, and answers 404 with no
// body to anyone else (nothing says the endpoint exists). The engine is idempotent, so a retry or
// an overlap sends nothing twice.
import { getDb } from "@/lib/db";
import { describeError } from "@/lib/describe-error";
import { runTick } from "@/modules/reminders/engine";
import { isTickAuthorized, tickSecrets } from "@/modules/reminders/env";
import { logEvent } from "@/modules/reminders/log";
import { channelsFromEnv } from "@/modules/reminders/runtime";
import { listReminderSources } from "@/modules/reminders/contracts";
import { ensureReminderSources } from "@/lib/reminder-sources";

// A tick sends a handful of messages in sequence: well under a minute.
export const maxDuration = 60;
// Never cached, whatever the method.
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  if (!isTickAuthorized(request.headers.get("authorization"))) {
    // A server with no secret set answers like any other: 404. Only the log tells the owner why.
    if (tickSecrets().length === 0) {
      logEvent("error", "reminders_tick_unconfigured", {
        hint: "Set REMINDERS_CRON_SECRET (and CRON_SECRET to the same value) with 16+ characters",
      });
    }
    return new Response(null, { status: 404 });
  }

  try {
    ensureReminderSources();
    const summary = await runTick({
      db: getDb(),
      now: new Date(),
      sources: listReminderSources(),
      channelsFor: channelsFromEnv,
    });
    logEvent("info", "reminders_tick", summary);
    return Response.json({ ok: true, ...summary }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logEvent("error", "reminders_tick_failed", describeError(error));
    return Response.json({ ok: false }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}

export const GET = handle;
export const POST = handle;
