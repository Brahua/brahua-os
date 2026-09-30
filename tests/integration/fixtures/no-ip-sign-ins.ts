// Run by auth-no-ip.test.ts in a child process with NODE_ENV=production: Better Auth reads
// NODE_ENV once at import, and under "test" it would give IP-less requests 127.0.0.1.
// Prints the sign-in statuses and the rate-limit keys as JSON.
import { resolveAuthEnv } from "@/lib/auth-env";
import { createAuth } from "@/lib/auth";
import { createDb } from "@/lib/db";
import { authRateLimits } from "@/modules/core/db/auth-schema";
import { upsertOwner } from "@/modules/core/owner";
import { testDatabaseUrl } from "../helpers";

const BASE_URL = "http://localhost:3417";
const OWNER = "owner@example.com";
const PASSWORD = "correct horse battery";

async function main() {
  const db = createDb(testDatabaseUrl());
  try {
    const auth = createAuth(
      db,
      resolveAuthEnv({
        BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
        BETTER_AUTH_URL: BASE_URL,
        OWNER_EMAIL: OWNER,
        NODE_ENV: "production",
      }),
    );
    await upsertOwner(db, { email: OWNER, password: PASSWORD });

    // No x-forwarded-for header at all.
    const signIn = async (password: string) =>
      (
        await auth.handler(
          new Request(`${BASE_URL}/api/auth/sign-in/email`, {
            method: "POST",
            headers: { "content-type": "application/json", origin: BASE_URL },
            body: JSON.stringify({ email: OWNER, password }),
          }),
        )
      ).status;

    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 6; attempt++) statuses.push(await signIn(`wrong ${attempt}`));
    statuses.push(await signIn(PASSWORD));

    const keys = (await db.select({ key: authRateLimits.key }).from(authRateLimits)).map(
      (row) => row.key,
    );
    console.log(JSON.stringify({ statuses, keys }));
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
