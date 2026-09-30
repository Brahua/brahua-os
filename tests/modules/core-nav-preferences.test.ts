import { expect, test } from "vitest";
import {
  areShortcutsEnabled,
  isSidebarCollapsed,
  SHORTCUTS_COOKIE,
  shortcutsCookie,
  SIDEBAR_COOKIE,
  sidebarCookie,
} from "@/modules/core/nav-preferences";

test("only an explicit 'collapsed' cookie collapses the sidebar", () => {
  expect(isSidebarCollapsed("collapsed")).toBe(true);
  expect(isSidebarCollapsed("expanded")).toBe(false);
  expect(isSidebarCollapsed(undefined)).toBe(false);
  expect(isSidebarCollapsed("garbage")).toBe(false);
});

test("shortcuts are on unless explicitly turned off", () => {
  expect(areShortcutsEnabled(undefined)).toBe(true);
  expect(areShortcutsEnabled("on")).toBe(true);
  expect(areShortcutsEnabled("garbage")).toBe(true);
  expect(areShortcutsEnabled("off")).toBe(false);
});

test("the cookies last a year on the whole site, Secure over HTTPS", () => {
  expect(sidebarCookie(true, true)).toBe(
    `${SIDEBAR_COOKIE}=collapsed; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
  );
  expect(sidebarCookie(false, false)).toBe(
    `${SIDEBAR_COOKIE}=expanded; Path=/; Max-Age=31536000; SameSite=Lax`,
  );
  expect(shortcutsCookie(false, true)).toBe(
    `${SHORTCUTS_COOKIE}=off; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
  );
});
