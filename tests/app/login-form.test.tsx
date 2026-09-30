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
  PASSKEY_RATE_LIMIT_MESSAGE,
  PASSKEY_SIGN_IN_FAILED_MESSAGE,
  PASSKEY_UNSUPPORTED_MESSAGE,
} from "@/lib/passkey-messages";
import { usePasskeySupport } from "@/lib/passkey-support";

const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: vi.fn(), passkey: vi.fn() } },
}));
vi.mock("@/lib/passkey-support", () => ({ usePasskeySupport: vi.fn() }));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthnAutofill: vi.fn(),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));

const signIn = vi.mocked(authClient.signIn.email);
const signInPasskey = vi.mocked(authClient.signIn.passkey);
const autofillSupported = vi.mocked(browserSupportsWebAuthnAutofill);

beforeEach(() => {
  signIn.mockReset();
  signInPasskey.mockReset();
  router.replace.mockReset();
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
  test("labels both fields and shows field errors, focusing the first invalid one", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "Entrar" }));

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
    await user.click(screen.getByRole("button", { name: "Entrar" }));

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

  test("explains the rate limit on a 429", async () => {
    signIn.mockResolvedValue({ data: null, error: { status: 429 } } as never);
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(RATE_LIMIT_MESSAGE);
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });

  test("a network failure shows the generic message and never leaves the form stuck", async () => {
    signIn.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<LoginForm />);

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(GENERIC_MESSAGE);
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
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
  const passkeyButton = () => screen.getByRole("button", { name: "Entrar con passkey" });

  beforeEach(() => {
    vi.mocked(usePasskeySupport).mockReturnValue(true);
  });

  test("the email field offers passkeys in its autofill list", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username webauthn");
  });

  test("goes to the app after signing in with a passkey", async () => {
    signInPasskey.mockResolvedValue({ data: {}, error: null } as never);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(passkeyButton());

    expect(signInPasskey).toHaveBeenCalledWith();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  test("closing the browser prompt shows nothing and leaves everything usable", async () => {
    signInPasskey.mockResolvedValue({
      data: null,
      error: { status: 400, code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" },
    } as never);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(passkeyButton());

    await waitFor(() => expect(passkeyButton()).toBeEnabled());
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  test("a rejected passkey is announced without touching the password field", async () => {
    signInPasskey.mockResolvedValue({
      data: null,
      error: { status: 401, code: "PASSKEY_NOT_FOUND" },
    } as never);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(passkeyButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_SIGN_IN_FAILED_MESSAGE);
    expect(screen.getByLabelText("Contraseña")).not.toHaveAccessibleDescription(
      PASSKEY_SIGN_IN_FAILED_MESSAGE,
    );
    expect(passkeyButton()).toBeEnabled();
  });

  test("explains the rate limit and survives a network failure", async () => {
    signInPasskey.mockResolvedValueOnce({ data: null, error: { status: 429 } } as never);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(passkeyButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_RATE_LIMIT_MESSAGE);

    signInPasskey.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await user.click(passkeyButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/No se pudo usar/));
    expect(passkeyButton()).toBeEnabled();
  });

  test("with autofill support, a background request waits for a passkey from the list", async () => {
    autofillSupported.mockResolvedValue(true);
    signInPasskey.mockResolvedValue({ data: {}, error: null } as never);
    render(<LoginForm />);

    await waitFor(() => expect(signInPasskey).toHaveBeenCalledWith({ autoFill: true }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  test("a cancelled background request is silent, and leaving the page cancels it", async () => {
    autofillSupported.mockResolvedValue(true);
    signInPasskey.mockResolvedValue({
      data: null,
      error: { status: 400, code: "ERROR_CEREMONY_ABORTED" },
    } as never);
    const { unmount } = render(<LoginForm />);

    await waitFor(() => expect(signInPasskey).toHaveBeenCalled());
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    unmount();
    expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalled();
  });

  test("an unsupported browser disables the button and says why", () => {
    vi.mocked(usePasskeySupport).mockReturnValue(false);
    render(<LoginForm />);

    expect(passkeyButton()).toBeDisabled();
    expect(passkeyButton()).toHaveAccessibleDescription(PASSKEY_UNSUPPORTED_MESSAGE);
    expect(autofillSupported).not.toHaveBeenCalled();
  });
});

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "owner@example.com");
  await user.type(screen.getByLabelText("Contraseña"), "a correct password");
  await user.click(screen.getByRole("button", { name: "Entrar" }));
}
