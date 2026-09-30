// Per-device navigation preferences, kept in cookies so the layout reads them on the server and
// the first paint is already right (localStorage would flash). Not HttpOnly: the client writes
// them. Neither is sensitive.

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Collapsed/expanded desktop sidebar. */
export const SIDEBAR_COOKIE = "bo_sidebar";
/**
 * Single-key shortcuts (`[`, `1`–`8`) on or off. WCAG 2.1.4 requires a way to turn them off;
 * the switch lives in Ajustes (/settings). Default on: the design relies on them.
 */
export const SHORTCUTS_COOKIE = "bo_shortcuts";

export function isSidebarCollapsed(cookieValue: string | undefined): boolean {
  return cookieValue === "collapsed";
}

export function areShortcutsEnabled(cookieValue: string | undefined): boolean {
  return cookieValue !== "off";
}

function cookie(name: string, value: string, secure: boolean): string {
  return `${name}=${value}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** `document.cookie` assignment for the new sidebar state. */
export function sidebarCookie(collapsed: boolean, secure: boolean): string {
  return cookie(SIDEBAR_COOKIE, collapsed ? "collapsed" : "expanded", secure);
}

/** `document.cookie` assignment for the shortcuts preference (the switch in Ajustes). */
export function shortcutsCookie(enabled: boolean, secure: boolean): string {
  return cookie(SHORTCUTS_COOKIE, enabled ? "on" : "off", secure);
}
