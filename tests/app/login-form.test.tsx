import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { LoginForm } from "@/app/(auth)/login/login-form";
import {
  CREDENTIALS_MESSAGE,
  GENERIC_MESSAGE,
  RATE_LIMIT_MESSAGE,
  signInErrorMessage,
  validateLogin,
} from "@/app/(auth)/login/validation";
import { browserSupportsWebAuthnAutofill, WebAuthnAbortService } from "@simplewebauthn/browser";
import { authClient } from "@/lib/auth-client";
import {
  PASSKEY_GENERIC_MESSAGE,
  PASSKEY_RATE_LIMIT_MESSAGE,
  PASSKEY_SIGN_IN_FAILED_MESSAGE,
  PASSKEY_UNSUPPORTED_MESSAGE,
} from "@/lib/passkey-messages";
import { signInWithPasskey, type PasskeySignInResult } from "@/lib/passkey-sign-in";
import { usePasskeySupport } from "@/lib/passkey-support";

const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { email: vi.fn() } } }));
vi.mock("@/lib/passkey-support", () => ({ usePasskeySupport: vi.fn() }));
vi.mock("@/lib/passkey-sign-in", () => ({ signInWithPasskey: vi.fn() }));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthnAutofill: vi.fn(),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));

const signIn = vi.mocked(authClient.signIn.email);
const passkeyCeremony = vi.mocked(signInWithPasskey);
const autofillSupported = vi.mocked(browserSupportsWebAuthnAutofill);

const SIGNED_IN: PasskeySignInResult = { outcome: "signed-in" };
const failed = (status: number | undefined, code?: string): PasskeySignInResult => ({
  outcome: "failed",
  error: { status, code },
});
const CANCELLED = failed(400, "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY");
/** Never settles: an autofill request waiting for the person to pick a passkey. */
const waiting = () => new Promise<PasskeySignInResult>(() => {});

beforeEach(() => {
  signIn.mockReset();
  passkeyCeremony.mockReset();
  router.replace.mockReset();
  vi.mocked(WebAuthnAbortService.cancelCeremony).mockReset();
  // jsdom has no WebAuthn; each passkey test opts in.
  vi.mocked(usePasskeySupport).mockReturnValue(false);
  autofillSupported.mockReset();
  autofillSupported.mockResolvedValue(false);
});

describe("validateLogin", () => {
  test("asks for both fields and a plausible email", () => {
    expect(validateLogin({ email: "", password: "" })).toEqual({
      email: "Escribe tu email.",
      password: "Escribe tu contraseña.",
    });
    expect(validateLogin({ email: "yo@", password: "x" }).email).toMatch(/Revisa el email/);
    expect(validateLogin({ email: " yo@example.com ", password: "x" })).toEqual({});
  });
});

describe("signInErrorMessage", () => {
  test("only a credentials rejection says the email or password do not match", () => {
    expect(signInErrorMessage({ status: 401 })).toBe(CREDENTIALS_MESSAGE);
    expect(signInErrorMessage({ status: 400, code: "INVALID_EMAIL" })).toBe(CREDENTIALS_MESSAGE);
  });

  test("429 explains the rate limit", () => {
    expect(signInErrorMessage({ status: 429 })).toBe(RATE_LIMIT_MESSAGE);
  });

  test("403, other 400s, 5xx and unknown errors get the generic message", () => {
    for (const error of [
      { status: 403 },
      { status: 400, code: "PASSWORD_TOO_LONG" },
      { status: 500 },
      {},
      null,
      undefined,
    ]) {
      expect(signInErrorMessage(error)).toBe(GENERIC_MESSAGE);
    }
  });
});

describe("LoginForm", () => {
  const submit = () => screen.getByRole("button", { name: "Entrar" });

  test("labels both fields and shows field errors, focusing the first invalid one", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(submit());

    const email = screen.getByLabelText("Email");
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Escribe tu email.");
    expect(screen.getByLabelText("Contraseña")).toHaveAccessibleDescription(
      "Escribe tu contraseña.",
    );
    expect(signIn).not.toHaveBeenCalled();
  });

  test("announces a failed sign-in, clears the password and focuses it", async () => {
    signIn.mockResolvedValue({ data: null, error: { status: 401 } } as never);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "wrong password!");
    await user.click(submit());

    expect(await screen.findByRole("alert")).toHaveTextContent(CREDENTIALS_MESSAGE);
    // The decorative LCD tag is not part of the announcement.
    expect(screen.getByText("Acceso")).toHaveAttribute("aria-hidden", "true");
    const password = screen.getByLabelText("Contraseña");
    expect(password).toHaveValue("");
    expect(password).toHaveFocus();
    // The message stays attached to the focused field.
    expect(password).toHaveAccessibleDescription(CREDENTIALS_MESSAGE);
    expect(signIn).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "wrong password!",
      rememberMe: true,
    });
    expect(router.replace).not.toHaveBeenCalled();
  });

  test("while waiting, the submit key keeps the focus (aria-disabled, not disabled)", async () => {
    let resolve: (value: unknown) => void = () => {};
    signIn.mockReturnValue(new Promise((r) => (resolve = r)) as never);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "a correct password");
    await user.keyboard("{Enter}");
    const pending = screen.getByRole("button", { name: "Entrando…" });
    await user.click(pending);

    expect(pending).toHaveAttribute("aria-disabled", "true");
    expect(pending).not.toBeDisabled();
    expect(pending).toHaveFocus();
    // Pressing it again does nothing.
    expect(signIn).toHaveBeenCalledTimes(1);
    resolve({ data: null, error: { status: 401 } });
    await waitFor(() => expect(submit()).toHaveAttribute("aria-disabled", "false"));
  });

  test("explains the rate limit on a 429", async () => {
    signIn.mockResolvedValue({ data: null, error: { status: 429 } } as never);
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(RATE_LIMIT_MESSAGE);
    expect(submit()).toHaveAttribute("aria-disabled", "false");
  });

  test("a network failure shows the generic message and never leaves the form stuck", async () => {
    signIn.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_MESSAGE);
    expect(submit()).toHaveAttribute("aria-disabled", "false");
    const password = screen.getByLabelText("Contraseña");
    expect(password).toHaveFocus();
    expect(password).toHaveAccessibleDescription(GENERIC_MESSAGE);
    expect(router.replace).not.toHaveBeenCalled();
  });

  test("goes to the app after a successful sign-in", async () => {
    signIn.mockResolvedValue({ data: {}, error: null } as never);
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillAndSubmit(user);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });
});

describe("LoginForm with a passkey", () => {
  const passkeyButton = () => screen.getByRole("button", { name: /passkey|Entrando/ });

  beforeEach(() => {
    vi.mocked(usePasskeySupport).mockReturnValue(true);
  });

  test("the email field offers passkeys in its autofill list", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username webauthn");
  });

  test("goes to the app after signing in with the button", async () => {
    passkeyCeremony.mockResolvedValue(SIGNED_IN);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(passkeyButton());

    expect(passkeyCeremony).toHaveBeenCalledWith(expect.objectContaining({ autofill: false }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  test("while the prompt is open the button keeps the focus and ignores presses", async () => {
    passkeyCeremony.mockReturnValue(waiting());
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(passkeyButton());
    const button = screen.getByRole("button", { name: "Esperando la passkey…" });
    await user.click(button);

    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(passkeyCeremony).toHaveBeenCalledTimes(1);
  });

  test("closing the browser prompt shows nothing and leaves everything usable", async () => {
    passkeyCeremony.mockResolvedValue(CANCELLED);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(passkeyButton());

    await waitFor(() => expect(passkeyButton()).toHaveAttribute("aria-disabled", "false"));
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(router.replace).not.toHaveBeenCalled();
  });

  test("a rejected passkey is announced and described on the passkey button", async () => {
    passkeyCeremony.mockResolvedValue(failed(401, "PASSKEY_NOT_FOUND"));
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(passkeyButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_SIGN_IN_FAILED_MESSAGE);
    expect(passkeyButton()).toHaveAccessibleDescription(PASSKEY_SIGN_IN_FAILED_MESSAGE);
    expect(passkeyButton()).toHaveFocus();
    expect(screen.getByLabelText("Contraseña")).not.toHaveAccessibleDescription(
      PASSKEY_SIGN_IN_FAILED_MESSAGE,
    );
  });

  test("Better Auth's AUTH_CANCELLED is a failure (e.g. network), not a silent cancel", async () => {
    passkeyCeremony.mockResolvedValue(failed(400, "AUTH_CANCELLED"));
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(passkeyButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_GENERIC_MESSAGE);
  });

  test("after a 429 the autofill request is not restarted", async () => {
    autofillSupported.mockResolvedValue(true);
    // 1st: autofill on load (waits); 2nd: the button, rate limited.
    passkeyCeremony.mockReturnValueOnce(waiting()).mockResolvedValueOnce(failed(429));
    const user = userEvent.setup();
    render(<LoginForm />);
    await waitFor(() => expect(passkeyCeremony).toHaveBeenCalledTimes(1));

    await user.click(passkeyButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_RATE_LIMIT_MESSAGE);
    await new Promise((r) => setTimeout(r, 20));
    expect(passkeyCeremony).toHaveBeenCalledTimes(2);
  });

  test("after a cancelled button attempt, the autofill request starts again", async () => {
    autofillSupported.mockResolvedValue(true);
    passkeyCeremony
      .mockReturnValueOnce(waiting())
      .mockResolvedValueOnce(CANCELLED)
      .mockReturnValue(waiting());
    const user = userEvent.setup();
    render(<LoginForm />);
    await waitFor(() => expect(passkeyCeremony).toHaveBeenCalledTimes(1));

    await user.click(passkeyButton());

    await waitFor(() => expect(passkeyCeremony).toHaveBeenCalledTimes(3));
    expect(passkeyCeremony).toHaveBeenLastCalledWith(expect.objectContaining({ autofill: true }));
  });

  test("autofill: a picked passkey shows a busy state and goes to the app", async () => {
    autofillSupported.mockResolvedValue(true);
    let finish: (result: PasskeySignInResult) => void = () => {};
    passkeyCeremony.mockImplementation(
      ({ onVerifying }) =>
        new Promise((resolve) => {
          onVerifying?.();
          finish = resolve;
        }),
    );
    render(<LoginForm />);

    expect(await screen.findByRole("button", { name: "Entrando…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    finish(SIGNED_IN);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  test("autofill: a rejected passkey is announced and the list is offered again", async () => {
    autofillSupported.mockResolvedValue(true);
    passkeyCeremony
      .mockResolvedValueOnce(failed(500, "UNABLE_TO_CREATE_SESSION"))
      .mockReturnValue(waiting());
    render(<LoginForm />);

    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_SIGN_IN_FAILED_MESSAGE);
    await waitFor(() => expect(passkeyCeremony).toHaveBeenCalledTimes(2));
    expect(passkeyCeremony).toHaveBeenLastCalledWith(expect.objectContaining({ autofill: true }));
    expect(passkeyButton()).toHaveAttribute("aria-disabled", "false");
  });

  test("autofill: a background failure that is not a rejection stays silent", async () => {
    autofillSupported.mockResolvedValue(true);
    passkeyCeremony.mockResolvedValueOnce(failed(429));
    render(<LoginForm />);

    await waitFor(() => expect(passkeyCeremony).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(passkeyCeremony).toHaveBeenCalledTimes(1);
  });

  test("an outdated attempt never acts: only the newest one counts", async () => {
    autofillSupported.mockResolvedValue(true);
    let finishAutofill: (result: PasskeySignInResult) => void = () => {};
    let autofillIsCurrent: () => boolean = () => true;
    passkeyCeremony
      .mockImplementationOnce(({ isCurrent }) => {
        autofillIsCurrent = isCurrent;
        return new Promise((resolve) => (finishAutofill = resolve));
      })
      .mockReturnValueOnce(waiting());
    const user = userEvent.setup();
    render(<LoginForm />);
    await waitFor(() => expect(passkeyCeremony).toHaveBeenCalledTimes(1));

    await user.click(passkeyButton());

    // The button made the autofill attempt outdated; its late result is ignored.
    expect(autofillIsCurrent()).toBe(false);
    finishAutofill(failed(401, "PASSKEY_NOT_FOUND"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Esperando la passkey…" })).toBeInTheDocument();
  });

  test("leaving the page makes attempts outdated and closes the prompt", async () => {
    autofillSupported.mockResolvedValue(true);
    let autofillIsCurrent: () => boolean = () => true;
    passkeyCeremony.mockImplementationOnce(({ isCurrent }) => {
      autofillIsCurrent = isCurrent;
      return waiting();
    });
    const { unmount } = render(<LoginForm />);
    await waitFor(() => expect(passkeyCeremony).toHaveBeenCalled());

    unmount();
    expect(autofillIsCurrent()).toBe(false);
    expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalled();
  });

  test("an unsupported browser: reachable with Tab, marked disabled, and says why", async () => {
    vi.mocked(usePasskeySupport).mockReturnValue(false);
    const user = userEvent.setup();
    render(<LoginForm />);

    const button = passkeyButton();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription(PASSKEY_UNSUPPORTED_MESSAGE);
    await user.click(button);
    expect(passkeyCeremony).not.toHaveBeenCalled();
    expect(autofillSupported).not.toHaveBeenCalled();
  });
});

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "owner@example.com");
  await user.type(screen.getByLabelText("Contraseña"), "a correct password");
  await user.click(screen.getByRole("button", { name: "Entrar" }));
}
