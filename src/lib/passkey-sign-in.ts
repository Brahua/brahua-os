// Passkey sign-in ceremony (client only), run step by step instead of through
// `authClient.signIn.passkey` so the login page can tell attempts apart: the autofill request
// and the button can overlap, and an outdated attempt must never start (and so abort) a newer
// one's browser prompt.
import { startAuthentication, WebAuthnError } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { authClient } from "./auth-client";
import type { PasskeyError } from "./passkey-messages";

export type PasskeySignInResult =
  | { outcome: "signed-in" }
  /** A newer attempt started (or the page went away): ignore this one entirely. */
  | { outcome: "stale" }
  | { outcome: "failed"; error: NonNullable<PasskeyError> };

type Options = {
  /** Conditional UI: wait for a passkey picked from the Email field's autofill list. */
  autofill: boolean;
  /** False once a newer attempt started; checked before every step. */
  isCurrent: () => boolean;
  /** A passkey was picked and is being verified: time to show a busy state. */
  onVerifying?: () => void;
};

type FetchError = { status?: number; code?: string } | null;

function failed(error: FetchError | undefined): PasskeySignInResult {
  return { outcome: "failed", error: { status: error?.status, code: error?.code } };
}

export async function signInWithPasskey({
  autofill,
  isCurrent,
  onVerifying,
}: Options): Promise<PasskeySignInResult> {
  let options: PublicKeyCredentialRequestOptionsJSON;
  try {
    const response = await authClient.$fetch<PublicKeyCredentialRequestOptionsJSON>(
      "/passkey/generate-authenticate-options",
      { method: "GET", throw: false },
    );
    if (!response.data) return failed(response.error as FetchError);
    options = response.data;
  } catch {
    return failed({ code: "NETWORK_ERROR" });
  }

  // Checked right before the prompt: a stale attempt would abort the current one's prompt.
  if (!isCurrent()) return { outcome: "stale" };
  let credential: Awaited<ReturnType<typeof startAuthentication>>;
  try {
    credential = await startAuthentication({
      // The server only accepts user-verified assertions; the plugin asks for "preferred".
      optionsJSON: { ...options, userVerification: "required" },
      useBrowserAutofill: autofill,
    });
  } catch (error) {
    if (!isCurrent()) return { outcome: "stale" };
    return failed({
      status: 400,
      code: error instanceof WebAuthnError ? error.code : "WEBAUTHN_ERROR",
    });
  }
  if (!isCurrent()) return { outcome: "stale" };

  onVerifying?.();
  try {
    // Same body as Better Auth's own client: the assertion without clientExtensionResults.
    const { id, rawId, response, type, authenticatorAttachment } = credential;
    const verified = await authClient.$fetch<unknown>("/passkey/verify-authentication", {
      method: "POST",
      body: { response: { id, rawId, response, type, authenticatorAttachment } },
      throw: false,
    });
    // A verified passkey means a session cookie was set: signed in, even if outdated.
    return verified.error ? failed(verified.error as FetchError) : { outcome: "signed-in" };
  } catch {
    return failed({ code: "NETWORK_ERROR" });
  }
}
