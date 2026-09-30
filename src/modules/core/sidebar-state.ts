// Collapsed/expanded sidebar, remembered per device in a cookie. The layout reads it on the
// server, so the first paint already has the right width (localStorage would flash).

export const SIDEBAR_COOKIE = "bo_sidebar";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function isSidebarCollapsed(cookieValue: string | undefined): boolean {
  return cookieValue === "collapsed";
}

/** `document.cookie` assignment for the new state (not HttpOnly: the client writes it). */
export function sidebarCookie(collapsed: boolean, secure: boolean): string {
  const value = collapsed ? "collapsed" : "expanded";
  return `${SIDEBAR_COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
