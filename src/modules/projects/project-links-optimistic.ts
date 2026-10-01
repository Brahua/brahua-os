// The optimistic view of a project's links (P5): each change shows at once while it is saved.
// Pure and client-safe. Robust to a newer server list: a change about a link that is gone (or
// a duplicate add) leaves the list as it is.
import { moveId } from "@/modules/core/life-area-order";
import type { ProjectLinkSummary } from "./project-link-input";

export type LinksChange =
  /** At `position` (0-based), or at the end. */
  | { type: "add"; link: ProjectLinkSummary; position?: number }
  | { type: "update"; id: string; url: string; label: string | null }
  | { type: "move"; id: string; to: number }
  | { type: "remove"; id: string };

export function applyLinksChange(
  links: ProjectLinkSummary[],
  change: LinksChange,
): ProjectLinkSummary[] {
  switch (change.type) {
    case "add": {
      if (links.some((link) => link.id === change.link.id)) return links;
      const next = [...links];
      const at = Math.min(Math.max(change.position ?? next.length, 0), next.length);
      next.splice(at, 0, change.link);
      return next;
    }
    case "update":
      return links.map((link) =>
        link.id === change.id ? { ...link, url: change.url, label: change.label } : link,
      );
    case "move": {
      const from = links.findIndex((link) => link.id === change.id);
      if (from === -1) return links;
      const order = moveId(
        links.map((link) => link.id),
        from,
        change.to,
      );
      const byId = new Map(links.map((link) => [link.id, link]));
      return order.flatMap((id) => byId.get(id) ?? []);
    }
    case "remove":
      return links.filter((link) => link.id !== change.id);
  }
}

/** Ids of links being added, before the server gives them theirs (never sent to it). */
export const PENDING_LINK_PREFIX = "pending-link-";

export function isPendingLinkId(id: string): boolean {
  return id.startsWith(PENDING_LINK_PREFIX);
}
