// The optimistic view of a routine's exercises (E1): what the page shows while a change is on its
// way. Pure and client-safe. Each change applies over whatever the server sent last, so it stays
// right when the base list is newer than the change (a revalidation arrived first).
import { applyOrder } from "@/modules/core/life-area-order";
import type { RoutineItem } from "./routines-input";

type TargetsPatch = Pick<
  RoutineItem,
  "targetSets" | "repsMin" | "repsMax" | "targetSeconds" | "restSeconds"
>;

export type ItemChange =
  | { type: "add"; item: RoutineItem }
  | { type: "update"; id: string; targets: TargetsPatch }
  | { type: "remove"; id: string }
  | {
      type: "restore";
      item: RoutineItem;
      position: number;
      /** The neighbour it had above it: wins over `position` while it is still there. */
      afterId: string | null;
    }
  | { type: "reorder"; ids: readonly string[] };

/** `position` as 0…n-1 in list order (what the server writes). */
function renumber(items: readonly RoutineItem[]): RoutineItem[] {
  return items.map((item, index) =>
    item.position === index ? item : { ...item, position: index },
  );
}

export function applyItemChange(items: RoutineItem[], change: ItemChange): RoutineItem[] {
  switch (change.type) {
    case "add":
      if (items.some((item) => item.id === change.item.id)) return items;
      return renumber([...items, change.item]);
    case "update":
      return items.map((item) => (item.id === change.id ? { ...item, ...change.targets } : item));
    case "remove":
      return renumber(items.filter((item) => item.id !== change.id));
    case "restore": {
      if (items.some((item) => item.id === change.item.id)) return items;
      const next = [...items];
      const anchor = change.afterId ? next.findIndex((item) => item.id === change.afterId) : -1;
      const at = anchor !== -1 ? anchor + 1 : Math.min(change.position, next.length);
      next.splice(at, 0, change.item);
      return renumber(next);
    }
    case "reorder":
      return renumber(applyOrder(items, change.ids));
  }
}
