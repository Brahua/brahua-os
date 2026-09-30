import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import Home from "@/app/(app)/page";
import { requireOwner } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

beforeEach(() => {
  vi.mocked(requireOwner).mockReset();
});

test("home page shows the app name as its main heading", async () => {
  render(await Home());

  expect(screen.getByRole("heading", { level: 1, name: "brahua-os" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  expect(requireOwner).toHaveBeenCalled();
});

test("home page does not render without the owner (requireOwner redirects)", async () => {
  vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
  await expect(Home()).rejects.toThrow("NEXT_REDIRECT");
});
