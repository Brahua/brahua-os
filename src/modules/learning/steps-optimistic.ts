// The optimistic view of a track's syllabus (L1): what the section shows while a change is on its
// way. Pure and client-safe. Each change applies over whatever the server sent last, so it stays
// right when the base list is newer than the change (a revalidation arrived first).
import { applyOrder } from "@/modules/core/life-area-order";
import type { StepItem } from "./steps-input";

export type StepChange =
  | { type: "add"; step: StepItem }
  | { type: "rename"; id: string; title: string }
  | { type: "done"; id: string; doneAt: string | null }
  | { type: "remove"; id: string }
  | {
      type: "restore";
      step: StepItem;
      position: number;
      /** The neighbour it had above it: wins over `position` while it is still there. */
      afterId: string | null;
    }
  | { type: "reorder"; ids: readonly string[] };

/** `position` as 0…n-1 in list order (what the server writes). */
function renumber(items: readonly StepItem[]): StepItem[] {
  return items.map((item, index) =>
    item.position === index ? item : { ...item, position: index },
  );
}

export function applyStepChange(steps: StepItem[], change: StepChange): StepItem[] {
  switch (change.type) {
    case "add":
      if (steps.some((item) => item.id === change.step.id)) return steps;
      return renumber([...steps, change.step]);
    case "rename":
      return steps.map((item) => (item.id === change.id ? { ...item, title: change.title } : item));
    case "done":
      return steps.map((item) =>
        item.id === change.id ? { ...item, doneAt: change.doneAt } : item,
      );
    case "remove":
      return renumber(steps.filter((item) => item.id !== change.id));
    case "restore": {
      if (steps.some((item) => item.id === change.step.id)) return steps;
      const next = [...steps];
      const anchor = change.afterId ? next.findIndex((item) => item.id === change.afterId) : -1;
      const at = anchor !== -1 ? anchor + 1 : Math.min(change.position, next.length);
      next.splice(at, 0, change.step);
      return renumber(next);
    }
    case "reorder":
      return renumber(applyOrder(steps, change.ids));
  }
}
