// Optimistic changes to the areas screen (useOptimistic reducer). React re-runs it on top of the
// fresh server list whenever one arrives while a change is pending, so every action is written
// against whatever the base is: ids that are gone are ignored instead of failing.
import { applyOrder } from "./life-area-order";
import type { LifeAreaSummary } from "./life-area-input";

export type AreasView = {
  /** Active areas, in their order. */
  active: LifeAreaSummary[];
  /** Archived areas, most recently archived first. */
  archived: LifeAreaSummary[];
};

export type AreasChange =
  | { type: "reorder"; ids: string[] }
  | { type: "archive"; id: string }
  /** `end`: after every active area. `original`: back where it was (undoing an archive). */
  | { type: "unarchive"; id: string; position: "end" | "original" };

export function applyAreasChange(view: AreasView, change: AreasChange): AreasView {
  switch (change.type) {
    case "reorder":
      return { ...view, active: applyOrder(view.active, change.ids) };
    case "archive": {
      const area = view.active.find((item) => item.id === change.id);
      if (!area) return view;
      return {
        active: view.active.filter((item) => item.id !== change.id),
        archived: [area, ...view.archived],
      };
    }
    case "unarchive": {
      const area = view.archived.find((item) => item.id === change.id);
      if (!area) return view;
      const archived = view.archived.filter((item) => item.id !== change.id);
      if (change.position === "end") return { active: [...view.active, area], archived };
      // Archiving keeps sort_order, so the area goes back before the first one that sorts after.
      const index = view.active.findIndex((item) => item.sortOrder > area.sortOrder);
      const active = [...view.active];
      active.splice(index === -1 ? active.length : index, 0, area);
      return { active, archived };
    }
  }
}
