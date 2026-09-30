// Owner account management for `pnpm auth:owner` (and the E2E setup). Server/scripts only.
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { normalizeEmail } from "@/lib/auth-env";
import type { Database } from "@/lib/db";
import { authAccounts, authSessions, authUsers } from "./db/auth-schema";

/** Better Auth's provider id for email + password accounts. */
export const CREDENTIAL_PROVIDER = "credential";

export type UpsertOwnerResult = { created: boolean; revokedSessions: number };

/**
 * Creates the owner (verified email + credential account) or replaces its password hash.
 * Either way every existing session of that user is signed out.
 */
export async function upsertOwner(
  db: Database,
  { email, password }: { email: string; password: string },
): Promise<UpsertOwnerResult> {
  const ownerEmail = normalizeEmail(email);
  const hash = await hashPassword(password);

  return db.transaction(async (tx) => {
    let [user] = await tx.select().from(authUsers).where(eq(authUsers.email, ownerEmail));
    const created = !user;
    if (!user) {
      [user] = await tx
        .insert(authUsers)
        .values({
          id: randomUUID(),
          name: ownerEmail.split("@")[0],
          email: ownerEmail,
          emailVerified: true,
        })
        .returning();
    }

    const [account] = await tx
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .where(
        and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, CREDENTIAL_PROVIDER)),
      );
    if (account) {
      await tx.update(authAccounts).set({ password: hash }).where(eq(authAccounts.id, account.id));
    } else {
      // Better Auth finds the credential account by accountId === user id.
      await tx.insert(authAccounts).values({
        id: randomUUID(),
        accountId: user.id,
        providerId: CREDENTIAL_PROVIDER,
        userId: user.id,
        password: hash,
      });
    }

    const revoked = await tx
      .delete(authSessions)
      .where(eq(authSessions.userId, user.id))
      .returning({ id: authSessions.id });
    return { created, revokedSessions: revoked.length };
  });
}
