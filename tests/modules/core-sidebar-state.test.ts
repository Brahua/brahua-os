import { expect, test } from "vitest";
import { isSidebarCollapsed, SIDEBAR_COOKIE, sidebarCookie } from "@/modules/core/sidebar-state";

test("only an explicit 'collapsed' cookie collapses the sidebar", () => {
  expect(isSidebarCollapsed("collapsed")).toBe(true);
  expect(isSidebarCollapsed("expanded")).toBe(false);
  expect(isSidebarCollapsed(undefined)).toBe(false);
  expect(isSidebarCollapsed("garbage")).toBe(false);
});

test("the cookie lasts a year on the whole site, Secure over HTTPS", () => {
  expect(sidebarCookie(true, true)).toBe(
    `${SIDEBAR_COOKIE}=collapsed; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
  );
  expect(sidebarCookie(false, false)).toBe(
    `${SIDEBAR_COOKIE}=expanded; Path=/; Max-Age=31536000; SameSite=Lax`,
  );
});
