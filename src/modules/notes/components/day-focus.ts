"use client";

// Which day link sent the owner to another daily note («Día anterior» / «Día siguiente»), so the
// new page puts the focus back on the same link (or the h1) instead of the empty editor. Set on
// the click, read during the new page's first render, cleared once the focus is placed.

export type DayLink = "previous" | "next";

let pending: DayLink | null = null;

export function markDayLink(link: DayLink): void {
  pending = link;
}

/** The link that started this navigation, if any (doesn't clear it). */
export function pendingDayLink(): DayLink | null {
  return pending;
}

/** Takes the pending link (clears it). */
export function takeDayLink(): DayLink | null {
  const link = pending;
  pending = null;
  return link;
}
