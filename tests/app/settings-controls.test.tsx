import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ShortcutsSwitch } from "@/app/(app)/settings/_components/shortcuts-switch";
import { ThemePicker, themePreference } from "@/app/(app)/settings/_components/theme-picker";
import { SHORTCUTS_COOKIE } from "@/modules/core/nav-preferences";

const router = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const themeState = { theme: "dark" as string | undefined, setTheme: vi.fn() };
vi.mock("next-themes", () => ({ useTheme: () => themeState }));

beforeEach(() => {
  router.refresh.mockReset();
  themeState.theme = "dark";
  themeState.setTheme.mockReset();
});

describe("ThemePicker", () => {
  test("is a radio group with Oscuro, Claro and Sistema; the stored theme is checked", () => {
    themeState.theme = "system";
    render(<ThemePicker />);
    const group = screen.getByRole("radiogroup", { name: "Tema" });
    expect(group).toBeVisible();
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      "Oscuro",
      "Claro",
      "Sistema",
    ]);
    expect(screen.getByRole("radio", { name: "Sistema" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Sistema" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Oscuro" })).toHaveAttribute("tabindex", "-1");
  });

  test("clicking or moving with the arrow keys applies the theme", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);
    await user.click(screen.getByRole("radio", { name: "Claro" }));
    expect(themeState.setTheme).toHaveBeenLastCalledWith("light");

    screen.getByRole("radio", { name: "Oscuro" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(themeState.setTheme).toHaveBeenLastCalledWith("light");
    await user.keyboard("{End}");
    expect(themeState.setTheme).toHaveBeenLastCalledWith("system");
  });

  test("the server HTML is the same whatever is stored: hidden, with a fixed value", () => {
    // The stored theme only exists in the browser; hydration must match this HTML exactly.
    themeState.theme = "light";
    const html = renderToString(<ThemePicker />);
    expect(html).toContain("invisible");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Oscuro</);
  });

  test("unknown or missing stored values fall back to the default, dark", () => {
    expect(themePreference(undefined)).toBe("dark");
    expect(themePreference("sepia")).toBe("dark");
    expect(themePreference("light")).toBe("light");
    expect(themePreference("system")).toBe("system");
    expect(themePreference("dark")).toBe("dark");
  });
});

describe("ShortcutsSwitch", () => {
  afterEach(() => {
    document.cookie = `${SHORTCUTS_COOKIE}=; Max-Age=0; Path=/`;
  });

  test("is a described switch; turning it off writes the cookie and refreshes the layout", async () => {
    const user = userEvent.setup();
    render(<ShortcutsSwitch initialEnabled />);
    const toggle = screen.getByRole("switch", { name: "Atajos de teclado" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAccessibleDescription(/contrae la barra lateral/);

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(document.cookie).toContain(`${SHORTCUTS_COOKIE}=off`);
    expect(router.refresh).toHaveBeenCalledTimes(1);

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.cookie).toContain(`${SHORTCUTS_COOKIE}=on`);
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  test("starts off when the server says so, and Space turns it on", async () => {
    const user = userEvent.setup();
    render(<ShortcutsSwitch initialEnabled={false} />);
    const toggle = screen.getByRole("switch", { name: "Atajos de teclado" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    toggle.focus();
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.cookie).toContain(`${SHORTCUTS_COOKIE}=on`);
  });
});
