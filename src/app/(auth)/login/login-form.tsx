"use client";

import { browserSupportsWebAuthnAutofill, WebAuthnAbortService } from "@simplewebauthn/browser";
import { KeyRound, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Key, Lcd, TextField } from "@/design-system";
import { authClient } from "@/lib/auth-client";
import {
  isPasskeySignInRejection,
  PASSKEY_GENERIC_MESSAGE,
  PASSKEY_SIGN_IN_FAILED_MESSAGE,
  PASSKEY_UNSUPPORTED_MESSAGE,
  passkeySignInErrorMessage,
} from "@/lib/passkey-messages";
import { usePasskeySupport } from "@/lib/passkey-support";
import {
  GENERIC_MESSAGE,
  signInErrorMessage,
  validateLogin,
  type LoginFieldErrors,
} from "./validation";

const FORM_ERROR_ID = "login-form-error";
const PASSKEY_NOTE_ID = "login-passkey-note";

type FormError = { message: string; source: "password" | "passkey" };

/**
 * Background passkey request for the autofill list. Resolves when a passkey was picked and
 * verified ("signed-in"), picked and rejected by the server ("rejected"), or on anything else:
 * no autofill support, cancelled, replaced by the button, or a network error ("idle").
 */
async function autofillPasskey(): Promise<"signed-in" | "rejected" | "idle"> {
  try {
    if (!(await browserSupportsWebAuthnAutofill())) return "idle";
    const { error } = await authClient.signIn.passkey({ autoFill: true });
    if (!error) return "signed-in";
    return isPasskeySignInRejection(error) ? "rejected" : "idle";
  } catch {
    return "idle";
  }
}

export function LoginForm() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, setPending] = useState<"password" | "passkey" | null>(null);
  const passkeySupported = usePasskeySupport();

  const goToApp = useCallback(() => {
    router.replace("/");
    router.refresh();
  }, [router]);

  /**
   * Conditional UI: the browser offers the owner's passkey in the email field's autofill list.
   * The request waits in the background until a passkey is picked; the passkey button (or
   * leaving the page) cancels it. Only a rejection after picking a passkey is announced.
   */
  const startAutofill = useCallback(() => {
    void autofillPasskey().then((outcome) => {
      if (outcome === "signed-in") goToApp();
      else if (outcome === "rejected") {
        setFormError({ message: PASSKEY_SIGN_IN_FAILED_MESSAGE, source: "passkey" });
      }
    });
  }, [goToApp]);

  useEffect(() => {
    if (!passkeySupported) return;
    startAutofill();
    return () => WebAuthnAbortService.cancelCeremony();
  }, [passkeySupported, startAutofill]);

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
    if (pending) return;
    setPending("passkey");
    setFormError(null);
    let signedIn = false;
    try {
      // Replaces the background autofill request with the browser's passkey prompt.
      const { error } = await authClient.signIn.passkey();
      if (!error) signedIn = true;
      else {
        // Closing the prompt is not an error: nothing is announced.
        const message = passkeySignInErrorMessage(error);
        if (message) setFormError({ message, source: "passkey" });
      }
    } catch {
      setFormError({ message: PASSKEY_GENERIC_MESSAGE, source: "passkey" });
    } finally {
      if (!signedIn) setPending(null);
    }
    if (signedIn) goToApp();
    else startAutofill();
  }

  const passwordError = formError?.source === "password";

  return (
    <div className="flex flex-col gap-5">
      <form
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        aria-busy={pending === "password"}
      >
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
        <Key
          type="submit"
          variant="signal"
          size="lg"
          block
          icon={LogIn}
          disabled={pending !== null}
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
          disabled={pending !== null || passkeySupported === false}
          aria-describedby={passkeySupported === false ? PASSKEY_NOTE_ID : undefined}
        >
          {pending === "passkey" ? "Esperando la passkey…" : "Entrar con passkey"}
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
