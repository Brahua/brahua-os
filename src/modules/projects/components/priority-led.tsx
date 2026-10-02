import { Led } from "@/design-system";
import { cn } from "@/lib/cn";
import type { ProjectPriority } from "../project-constants";

/**
 * The priority's LED, on every option so color is never the only cue (the label stays): Alta in
 * the signal orange (like the card's), Media a neutral LED, Baja a hollow, muted ring. On the
 * selected (inverted) key the neutral ones invert with it; extensions.css `.bo-priority-led`.
 * Shared by projects and tasks (same priorities, same LEDs).
 */
export function PriorityLed({ priority }: { priority: ProjectPriority }) {
  return (
    <Led
      signal={priority === "high"}
      size="sm"
      data-priority-led={priority}
      className={cn("bo-priority-led", `bo-priority-led--${priority}`)}
    />
  );
}
