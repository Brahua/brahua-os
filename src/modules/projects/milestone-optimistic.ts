// The optimistic view of a project's milestones (P3): what the section shows while a change is
// on its way. Pure and client-safe. Each change applies over whatever the server sent last, so
// it stays right when the base list is newer than the change (a revalidation arrived first).
import { applyOrder } from "@/modules/core/life-area-order";
import type { ProjectMilestoneItem } from "./milestone-input";

export type MilestoneChange =
  | { type: "add"; milestone: ProjectMilestoneItem }
  | { type: "update"; id: string; title: string; dueDate: string | null }
  | { type: "done"; id: string; doneAt: Date | null }
  | { type: "remove"; id: string }
  | {
      type: "restore";
      milestone: ProjectMilestoneItem;
      position: number;
      /** The neighbour it had above it: wins over `position` while it is still there. */
      afterId?: string | null;
    }
  | { type: "reorder"; ids: readonly string[] };

/** `sortOrder` as 0…n-1 in list order (what the server writes). */
function renumber(items: readonly ProjectMilestoneItem[]): ProjectMilestoneItem[] {
  return items.map((item, index) =>
    item.sortOrder === index ? item : { ...item, sortOrder: index },
  );
}

export function applyMilestoneChange(
  milestones: ProjectMilestoneItem[],
  change: MilestoneChange,
): ProjectMilestoneItem[] {
  switch (change.type) {
    case "add":
      if (milestones.some((item) => item.id === change.milestone.id)) return milestones;
      return renumber([...milestones, change.milestone]);
    case "update":
      return milestones.map((item) =>
        item.id === change.id ? { ...item, title: change.title, dueDate: change.dueDate } : item,
      );
    case "done":
      return milestones.map((item) =>
        item.id === change.id
          ? // Checking one already done keeps its date (like the server's coalesce).
            { ...item, doneAt: change.doneAt === null ? null : (item.doneAt ?? change.doneAt) }
          : item,
      );
    case "remove":
      return renumber(milestones.filter((item) => item.id !== change.id));
    case "restore": {
      if (milestones.some((item) => item.id === change.milestone.id)) return milestones;
      const next = [...milestones];
      const anchor = change.afterId ? next.findIndex((item) => item.id === change.afterId) : -1;
      const at = anchor !== -1 ? anchor + 1 : Math.min(change.position, next.length);
      next.splice(at, 0, change.milestone);
      return renumber(next);
    }
    case "reorder":
      return renumber(applyOrder(milestones, change.ids));
  }
}
