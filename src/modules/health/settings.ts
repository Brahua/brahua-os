// «Ajustes» data access (server only, E4): the single `health_settings` row (`id = 1`), created on
// the first save. Trusts its input: callers check the owner and validate first.
//
// No advisory lock: the row is one upsert. «Terminar» reads it FOR SHARE inside its transaction
// (after the sessions lock), so a save at the same time waits for the finish or goes first.
import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { selectCheckHabitOptions } from "@/modules/habits/contracts";
import { healthSettings } from "./db/schema";
import type { Tx } from "./locks";
import type { HealthSettingsView, UpdateSettingsInput } from "./settings-input";

const SETTINGS_ID = 1;

/** The stored row's linked habit and when it last changed, or null without a row. */
export async function selectSettingsRow(
  db: Database | Tx,
  { forShare = false }: { forShare?: boolean } = {},
): Promise<{ habitId: string | null; updatedAt: Date } | null> {
  const query = db
    .select({ habitId: healthSettings.habitId, updatedAt: healthSettings.updatedAt })
    .from(healthSettings)
    .where(eq(healthSettings.id, SETTINGS_ID));
  const [row] = forShare ? await query.for("share") : await query;
  return row ?? null;
}

/** What the sheet shows: the stored habit and the habits a session can mark. Two queries. */
export async function selectSettingsView(db: Database | Tx): Promise<HealthSettingsView> {
  const row = await selectSettingsRow(db);
  const options = await selectCheckHabitOptions(db);
  return { habitId: row?.habitId ?? null, options };
}

/**
 * Saves the linked habit (null: none): creates the row the first time, then updates it. A habit
 * that a session can't mark (deleted, archived, a quantity habit or one to avoid) is refused.
 */
export async function upsertSettings(
  db: Database,
  { habitId }: UpdateSettingsInput,
): Promise<HealthSettingsView | "habitUnavailable"> {
  return db.transaction(async (tx) => {
    const options = await selectCheckHabitOptions(tx);
    if (habitId !== null && !options.some((option) => option.id === habitId)) {
      return "habitUnavailable";
    }
    await tx
      .insert(healthSettings)
      .values({ id: SETTINGS_ID, habitId, updatedAt: sql`date_trunc('milliseconds', now())` })
      .onConflictDoUpdate({
        target: healthSettings.id,
        set: { habitId, updatedAt: sql`date_trunc('milliseconds', now())` },
      });
    return { habitId, options };
  });
}
