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
  expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  expect(router.replace).not.toHaveBeenCalled();
});
