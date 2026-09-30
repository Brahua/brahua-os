import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { signInErrorMessage, validateLogin } from "@/app/(auth)/login/validation";
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
  test("uses one message for a wrong email or password, and explains the rate limit", () => {
    expect(signInErrorMessage(401)).toBe(signInErrorMessage(403));
    expect(signInErrorMessage(401)).toMatch(/no coinciden/);
    expect(signInErrorMessage(429)).toMatch(/Espera un minuto/);
    expect(signInErrorMessage(undefined)).toMatch(/conexión/);
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

    expect(await screen.findByRole("alert")).toHaveTextContent(/no coinciden/);
    const password = screen.getByLabelText("Contraseña");
    expect(password).toHaveValue("");
    expect(password).toHaveFocus();
    expect(signIn).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "wrong password!",
      rememberMe: true,
    });
    expect(router.replace).not.toHaveBeenCalled();
  });

  test("goes to the app after a successful sign-in", async () => {
    signIn.mockResolvedValue({ data: {}, error: null } as never);
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "a correct password");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });
});
