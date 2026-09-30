// Reads of the owner's passkeys (server only). Callers pass the user id from `requireOwner()`.
import { getAuthenticatorName } from "@better-auth/passkey";
import { asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { authPasskeys } from "./db/auth-schema";

/** What the UI shows of a passkey: never the key material or the credential id. */
export type PasskeySummary = {
  id: string;
  /** Name given when registering, else the authenticator (e.g. "iCloud Keychain"), else generic. */
  label: string;
  /** ISO timestamp, for `<time dateTime>`. */
  createdAt: string;
  /** Creation date in Spanish, in the owner's time zone. */
  createdLabel: string;
};

export const UNNAMED_PASSKEY_LABEL = "Passkey sin nombre";
/** SPEC-core: dates are shown in America/Lima. */
const DATE_FORMAT = new Intl.DateTimeFormat("es-PE", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/Lima",
});

export function formatPasskeyDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

export function passkeyLabel(name: string | null, aaguid: string | null): string {
  return name?.trim() || getAuthenticatorName(aaguid ?? undefined) || UNNAMED_PASSKEY_LABEL;
}

/** The user's passkeys, oldest first. */
export async function listPasskeys(db: Database, userId: string): Promise<PasskeySummary[]> {
  const rows = await db
    .select({
      id: authPasskeys.id,
      name: authPasskeys.name,
      aaguid: authPasskeys.aaguid,
      createdAt: authPasskeys.createdAt,
    })
    .from(authPasskeys)
    .where(eq(authPasskeys.userId, userId))
    .orderBy(asc(authPasskeys.createdAt));
  return rows.map((row) => ({
    id: row.id,
    label: passkeyLabel(row.name, row.aaguid),
    createdAt: row.createdAt.toISOString(),
    createdLabel: formatPasskeyDate(row.createdAt),
  }));
}
