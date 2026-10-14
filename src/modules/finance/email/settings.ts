// «Correos del banco» in Ajustes (server only): «Mis nombres» and the last four digits of each
// payment method. Same contract as the catalog: take the database, trust the input (the actions
// validate first). The methods list is locked like any other write of it (catalog.ts, "Locks").
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { lockCatalog } from "../catalog";
import { financePaymentMethods, financeSettings } from "../db/schema";
import type { EmailSettings } from "./input";

export type SettingsFailure = "methodGone";

export async function selectEmailSettings(db: Database): Promise<EmailSettings> {
  const [names, methods] = await Promise.all([
    db.select({ ownNames: financeSettings.ownNames }).from(financeSettings).limit(1),
    db
      .select({
        id: financePaymentMethods.id,
        name: financePaymentMethods.name,
        last4: financePaymentMethods.last4,
      })
      .from(financePaymentMethods)
      .where(isNull(financePaymentMethods.archivedAt))
      .orderBy(asc(financePaymentMethods.sortOrder), asc(financePaymentMethods.createdAt)),
  ]);
  return { ownNames: names[0]?.ownNames ?? [], methods };
}

/** Replaces «Mis nombres» (the settings row is created if it is the first write). */
export async function setOwnNames(db: Database, names: string[]): Promise<void> {
  await db
    .insert(financeSettings)
    .values({ id: 1, ownNames: names })
    .onConflictDoUpdate({ target: financeSettings.id, set: { ownNames: names } });
}

/** Sets (or clears, with null) the last four digits of a visible method. */
export async function setMethodLast4(
  db: Database,
  id: string,
  last4: string | null,
): Promise<SettingsFailure | null> {
  return db.transaction(async (tx) => {
    await lockCatalog(tx, "methods");
    const updated = await tx
      .update(financePaymentMethods)
      .set({ last4 })
      .where(and(eq(financePaymentMethods.id, id), isNull(financePaymentMethods.archivedAt)))
      .returning({ id: financePaymentMethods.id });
    return updated.length === 0 ? "methodGone" : null;
  });
}
