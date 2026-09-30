import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import SettingsPage, { metadata } from "@/app/(app)/settings/page";
import { requireOwner } from "@/lib/auth";
import { listPasskeys } from "@/modules/core/passkeys";

const cookieValues = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieValues.has(name) ? { name, value: cookieValues.get(name) } : undefined,
  }),
}));
vi.mock("@/lib/auth", () => ({ requireOwner: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/core/passkeys", () => ({ listPasskeys: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "dark", setTheme: vi.fn() }) }));

beforeEach(() => {
  cookieValues.clear();
  vi.mocked(requireOwner).mockReset();
  vi.mocked(requireOwner).mockResolvedValue({ user: { id: "owner-id" } } as never);
  vi.mocked(listPasskeys).mockReset();
  vi.mocked(listPasskeys).mockResolvedValue([]);
});

test("has its own title", () => {
  expect(metadata.title).toBe("Ajustes · brahua-os");
});

test("shows Apariencia, Teclado, Passkeys and Sesión as named sections", async () => {
  render(await SettingsPage());

  expect(screen.getByRole("heading", { level: 1, name: "Ajustes" })).toBeInTheDocument();
  // Named by the visible heading and described by the hint below it.
  const themes = within(screen.getByRole("region", { name: "Apariencia" })).getByRole(
    "radiogroup",
    { name: "Apariencia" },
  );
  expect(themes).not.toHaveAttribute("aria-label");
  expect(themes).toHaveAccessibleDescription(/«Sistema» sigue el modo claro u oscuro/);
  expect(
    within(screen.getByRole("region", { name: "Teclado" })).getByRole("switch", {
      name: "Atajos de teclado",
    }),
  ).toBeInTheDocument();
  expect(screen.getByRole("region", { name: /^Passkeys/ })).toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Sesión" })).getByRole("button", {
      name: "Cerrar sesión",
    }),
  ).toBeInTheDocument();
  expect(listPasskeys).toHaveBeenCalledWith(expect.anything(), "owner-id");
});

test("the shortcuts switch starts on by default and off with bo_shortcuts=off", async () => {
  const { unmount } = render(await SettingsPage());
  expect(screen.getByRole("switch", { name: "Atajos de teclado" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  unmount();

  cookieValues.set("bo_shortcuts", "off");
  render(await SettingsPage());
  expect(screen.getByRole("switch", { name: "Atajos de teclado" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("does not render without the owner (requireOwner redirects)", async () => {
  vi.mocked(requireOwner).mockRejectedValue(new Error("NEXT_REDIRECT"));
  await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT");
  expect(listPasskeys).not.toHaveBeenCalled();
});
