import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { SignOutButton } from "@/app/(app)/settings/_components/sign-out-button";
import { authClient } from "@/lib/auth-client";

const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));

const signOut = vi.mocked(authClient.signOut);

beforeEach(() => {
  signOut.mockReset();
  router.replace.mockReset();
});

test("signs out and goes to /login", async () => {
  signOut.mockResolvedValue({ data: { success: true }, error: null } as never);
  const user = userEvent.setup();
  render(<SignOutButton />);

  await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

  expect(router.replace).toHaveBeenCalledWith("/login");
});

test("a network failure re-enables the button and says so", async () => {
  signOut.mockRejectedValue(new TypeError("Failed to fetch"));
  const user = userEvent.setup();
  render(<SignOutButton />);

  await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

  expect(await screen.findByRole("status")).toHaveTextContent("No se pudo cerrar la sesión");
  const button = screen.getByRole("button", { name: "Cerrar sesión" });
  expect(button).toHaveAttribute("aria-disabled", "false");
  // aria-disabled, never disabled: the key never drops keyboard focus to the page.
  expect(button).not.toBeDisabled();
  expect(button).toHaveFocus();
  expect(router.replace).not.toHaveBeenCalled();
});

test("while signing out the key stays focused, looks disabled and ignores more presses", async () => {
  let finish: (value: unknown) => void = () => {};
  signOut.mockReturnValue(new Promise((resolve) => (finish = resolve)) as never);
  const user = userEvent.setup();
  render(<SignOutButton />);
  const button = screen.getByRole("button", { name: "Cerrar sesión" });

  await user.click(button);
  expect(button).toHaveAttribute("aria-disabled", "true");
  expect(button).toHaveClass("is-disabled");
  expect(button).toHaveFocus();
  await user.click(button);
  expect(signOut).toHaveBeenCalledTimes(1);

  finish({ data: null, error: { status: 500 } });
  expect(await screen.findByRole("status")).toHaveTextContent("No se pudo cerrar la sesión");
  expect(button).toHaveFocus();
});
