// Browser client for the Better Auth endpoints. Sign-in goes through the HTTP handler (not
// `auth.api` in a Server Action) so the database-backed rate limit applies to every attempt.
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({ plugins: [passkeyClient()] });
