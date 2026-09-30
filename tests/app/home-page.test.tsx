import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import Home from "@/app/(app)/page";
import { requireOwner } from "@/lib/auth";
import { listPasskeys } from "@/modules/core/passkeys";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/core/passkeys", () => ({ listPasskeys: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

beforeEach(() => {
  vi.mocked(requireOwner).mockReset();
  vi.mocked(requireOwner).mockResolvedValue({ user: { id: "owner-id" } } as never);
  vi.mocked(listPasskeys).mockReset();
  vi.mocked(listPasskeys).mockResolvedValue([]);
});

test("home page shows the app name, the passkey section and sign-out", async () => {
  render(await Home());

  expect(screen.getByRole("heading", { level: 1, name: "brahua-os" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: /Passkeys/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  expect(requireOwner).toHaveBeenCalled();
});

test("lists only the signed-in owner's passkeys", async () => {
  vi.mocked(listPasskeys).mockResolvedValue([
    {
      id: "pk-1",
      label: "MacBook",
      createdAt: "2026-09-30T15:00:00.000Z",
      createdLabel: "30 de setiembre de 2026",
    },
  ]);
  render(await Home());

  expect(listPasskeys).toHaveBeenCalledWith(expect.anything(), "owner-id");
  expect(screen.getByText("MacBook")).toBeInTheDocument();
});

test("home page does not render without the owner (requireOwner redirects)", async () => {
  vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
  await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
  expect(listPasskeys).not.toHaveBeenCalled();
});
