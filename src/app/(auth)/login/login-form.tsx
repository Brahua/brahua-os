"use client";

import { KeyRound, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Key, Lcd, TextField } from "@/design-system";
import {
  isPasskeySignInRejection,
  PASSKEY_SIGN_IN_FAILED_MESSAGE,
  PASSKEY_UNSUPPORTED_MESSAGE,
  passkeySignInErrorMessage,
} from "@/lib/passkey-messages";
import type { PasskeySignInResult } from "@/lib/passkey-sign-in";
import { usePasskeySupport } from "@/lib/passkey-support";
import {
  GENERIC_MESSAGE,
  signInErrorMessage,
  validateLogin,
  type LoginFieldErrors,
} from "./validation";

const FORM_ERROR_ID = "login-form-error";
const PASSKEY_NOTE_ID = "login-passkey-note";

/*
 * The sign-in code (Better Auth client, WebAuthn ceremony) loads on demand: the page paints and
 * hydrates without it, and it arrives before anyone can submit or pick a passkey (SPEC-core LCP).
 */
const loadAuthClient = () => import("@/lib/auth-client").then((module) => module.authClient);
const loadPasskeySignIn = () =>
  import("@/lib/passkey-sign-in").then((module) => module.signInWithPasskey);
/** Kept once loaded, so leaving the page can close the browser prompt synchronously. */
let webAuthn: typeof import("@simplewebauthn/browser") | undefined;
async function loadWebAuthn() {
  webAuthn ??= await import("@simplewebauthn/browser");
  return webAuthn;
}

type FormError = { message: string; source: "password" | "passkey" };
/** What the page is waiting for: the password check, the passkey prompt, or its verification. */
type Pending = "password" | "passkey-prompt" | "passkey-verifying" | null;

export function LoginForm() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const passkeySupported = usePasskeySupport();
  // Every passkey attempt (autofill or button) gets a number; only the latest one may act.
  const attempt = useRef(0);

  const goToApp = useCallback(() => {
    router.replace("/");
    router.refresh();
  }, [router]);

  const beginAttempt = useCallback(() => {
    const id = ++attempt.current;
    return () => attempt.current === id;
  }, []);

  /**
   * Conditional UI: the browser offers the owner's passkey in the email field's autofill list.
   * The request waits in the background until a passkey is picked; the passkey button (or
   * leaving the page) replaces it. Only a rejection after picking a passkey is announced, and
   * then the list is offered again. Anything else (no support, rate limit, network) stays silent
   * and the button remains available.
   */
  const startAutofill = useCallback(() => {
    function run() {
      const isCurrent = beginAttempt();
      void (async (): Promise<PasskeySignInResult> => {
        let signInWithPasskey: Awaited<ReturnType<typeof loadPasskeySignIn>>;
        try {
          const { browserSupportsWebAuthnAutofill } = await loadWebAuthn();
          if (!(await browserSupportsWebAuthnAutofill())) return { outcome: "stale" };
          signInWithPasskey = await loadPasskeySignIn();
        } catch {
          // No support, or the code could not load: the button remains available.
          return { outcome: "stale" };
        }
        return signInWithPasskey({
          autofill: true,
          isCurrent,
          onVerifying: () => setPending("passkey-verifying"),
        });
      })().then((result) => {
        if (result.outcome === "stale" || !isCurrent()) return;
        if (result.outcome === "signed-in") return goToApp();
        setPending(null);
        if (isPasskeySignInRejection(result.error)) {
          setFormError({ message: PASSKEY_SIGN_IN_FAILED_MESSAGE, source: "passkey" });
          run();
        }
      });
    }
    run();
  }, [beginAttempt, goToApp]);

  useEffect(() => {
    if (!passkeySupported) return;
    startAutofill();
    return () => {
      // Leaving the page: any attempt in flight becomes outdated and its prompt is closed.
      beginAttempt();
      // Not loaded yet means no prompt was ever opened.
      webAuthn?.WebAuthnAbortService.cancelCeremony();
    };
  }, [passkeySupported, startAutofill, beginAttempt]);

  function showFormError(message: string) {
    setFormError({ message, source: "password" });
    // Keep the email, clear the password and put the cursor back where it is needed.
    if (passwordRef.current) passwordRef.current.value = "";
    passwordRef.current?.focus();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    const errors = validateLogin({ email, password });
    setFieldErrors(errors);
    setFormError(null);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();

    setPending("password");
    let signedIn = false;
    try {
      const authClient = await loadAuthClient();
      const { error } = await authClient.signIn.email({ email, password, rememberMe: true });
      if (error) showFormError(signInErrorMessage(error));
      else signedIn = true;
    } catch {
      // Network failure or an unexpected response: never leave the form stuck.
      showFormError(GENERIC_MESSAGE);
    } finally {
      if (!signedIn) setPending(null);
    }
    if (signedIn) goToApp();
  }

  async function onPasskey() {
    // aria-disabled keeps the button focusable, so the guard lives here.
    if (pending || !passkeySupported) return;
    setPending("passkey-prompt");
    setFormError(null);
    // Replaces the background autofill request with the browser's passkey prompt.
    const isCurrent = beginAttempt();
    const result = await loadPasskeySignIn().then(
      (signInWithPasskey) =>
        signInWithPasskey({
          autofill: false,
          isCurrent,
          onVerifying: () => setPending("passkey-verifying"),
        }),
      // The code could not load (offline): same message as a network failure.
      (): PasskeySignInResult => ({ outcome: "failed", error: { code: "NETWORK_ERROR" } }),
    );
    if (result.outcome === "stale" || !isCurrent()) return;
    if (result.outcome === "signed-in") return goToApp();

    setPending(null);
    // Closing the prompt is not an error: nothing is announced.
    const message = passkeySignInErrorMessage(result.error);
    if (message) setFormError({ message, source: "passkey" });
    // Offer the autofill list again, except after a rate limit (it would only hit it again).
    if (result.error.status !== 429) startAutofill();
  }

  const passwordError = formError?.source === "password";
  const passkeyError = formError?.source === "passkey";
  const passkeyDescription =
    [passkeySupported === false ? PASSKEY_NOTE_ID : null, passkeyError ? FORM_ERROR_ID : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className="flex flex-col gap-5" aria-busy={pending !== null}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        {/* Always rendered, so screen readers announce the message as soon as it appears. */}
        <div role="alert" aria-atomic="true">
          {formError ? (
            <Lcd id={FORM_ERROR_ID} tag={<span aria-hidden>Acceso</span>} live={false}>
              {formError.message}
            </Lcd>
          ) : null}
        </div>
        <TextField
          ref={emailRef}
          name="email"
          type="email"
          label="Email"
          // "webauthn" lets the browser offer the passkey in this field's autofill list.
          autoComplete="username webauthn"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          error={fieldErrors.email}
        />
        <TextField
          ref={passwordRef}
          name="password"
          type="password"
          label="Contraseña"
          autoComplete="current-password"
          required
          error={fieldErrors.password}
          // The form error stays attached to the field that gets the focus after a failed sign-in.
          {...(passwordError ? { "aria-describedby": FORM_ERROR_ID } : {})}
        />
        {/* aria-disabled, not disabled: the focused key keeps its focus while waiting. */}
        <Key
          type="submit"
          variant="signal"
          size="lg"
          block
          icon={LogIn}
          aria-disabled={pending !== null}
        >
          {pending === "password" ? "Entrando…" : "Entrar"}
        </Key>
      </form>

      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-divider" />
        <span className="bo-text-label text-text-secondary">o</span>
        <span className="h-px flex-1 bg-divider" />
      </div>

      <div className="flex flex-col gap-2">
        <Key
          size="lg"
          block
          icon={KeyRound}
          onClick={onPasskey}
          aria-disabled={pending !== null || passkeySupported === false}
          // Unsupported: looks disabled but stays reachable with Tab, with the reason attached.
          className={passkeySupported === false ? "is-disabled" : undefined}
          aria-describedby={passkeyDescription}
        >
          {pending === "passkey-prompt"
            ? "Esperando la passkey…"
            : pending === "passkey-verifying"
              ? "Entrando…"
              : "Entrar con passkey"}
        </Key>
        {passkeySupported === false ? (
          <p id={PASSKEY_NOTE_ID} className="bo-text-body-sm text-text-secondary">
            {PASSKEY_UNSUPPORTED_MESSAGE}
          </p>
        ) : null}
      </div>
    </div>
  );
}
