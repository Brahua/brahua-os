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
import { authClient } from "@/lib/auth-client";

const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { email: vi.fn() } } }));

const signIn = vi.mocked(authClient.signIn.email);

beforeEach(() => {
  signIn.mockReset();
  router.replace.mockReset();
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

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "owner@example.com");
  await user.type(screen.getByLabelText("Contraseña"), "a correct password");
  await user.click(screen.getByRole("button", { name: "Entrar" }));
}
