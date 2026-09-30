"use client";

import { LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Key, Lcd, TextField } from "@/design-system";
import { authClient } from "@/lib/auth-client";
import {
  GENERIC_MESSAGE,
  signInErrorMessage,
  validateLogin,
  type LoginFieldErrors,
} from "./validation";

const FORM_ERROR_ID = "login-form-error";

export function LoginForm() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function showFormError(message: string) {
    setFormError(message);
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

    setPending(true);
    let signedIn = false;
    try {
      const { error } = await authClient.signIn.email({ email, password, rememberMe: true });
      if (error) showFormError(signInErrorMessage(error));
      else signedIn = true;
    } catch {
      // Network failure or an unexpected response: never leave the form stuck.
      showFormError(GENERIC_MESSAGE);
    } finally {
      if (!signedIn) setPending(false);
    }
    if (signedIn) {
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={pending}>
      {/* Always rendered, so screen readers announce the message as soon as it appears. */}
      <div role="alert" aria-atomic="true">
        {formError ? (
          <Lcd id={FORM_ERROR_ID} tag={<span aria-hidden>Acceso</span>} live={false}>
            {formError}
          </Lcd>
        ) : null}
      </div>
      <TextField
        ref={emailRef}
        name="email"
        type="email"
        label="Email"
        autoComplete="username"
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
        {...(formError ? { "aria-describedby": FORM_ERROR_ID } : {})}
      />
      <Key type="submit" variant="signal" size="lg" block icon={LogIn} disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </Key>
    </form>
  );
}
