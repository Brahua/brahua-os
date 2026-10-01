import { afterEach, expect, test, vi } from "vitest";
import { storedTheme, THEME_STORAGE_KEY } from "@/lib/stored-theme";

function prefersLight(light: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: light && query === "(prefers-color-scheme: light)",
  }));
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("dark by default and for anything unknown", () => {
  prefersLight(true);
  expect(storedTheme()).toBe("dark");
  localStorage.setItem(THEME_STORAGE_KEY, "sepia");
  expect(storedTheme()).toBe("dark");
});

test("the stored choice wins; system follows the OS", () => {
  prefersLight(false);
  localStorage.setItem(THEME_STORAGE_KEY, "light");
  expect(storedTheme()).toBe("light");
  localStorage.setItem(THEME_STORAGE_KEY, "system");
  expect(storedTheme()).toBe("dark");
  prefersLight(true);
  expect(storedTheme()).toBe("light");
});

test("blocked storage keeps the default", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("SecurityError");
  });
  expect(storedTheme()).toBe("dark");
});
