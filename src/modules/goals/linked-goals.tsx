// The "Metas" section that `goals` adds to a habit's page and to a project's page (G3, SPEC-goals
// "Contratos"): the goals that follow that habit or project. Server only. Registered with
// `registerHabitSection` and `registerProjectSection` by the composition root
// src/lib/goal-extensions.ts; `habits` and `projects` never import this file.
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import type { HabitSection } from "@/modules/habits/contracts";
import type { ProjectSection } from "@/modules/projects/contracts";
import { LinkedGoalsSection } from "./components/linked-goals-section";
import { selectGoalsFollowing } from "./goals";

export const habitGoalsSection: HabitSection = {
  id: "goals",
  async render({ habit }) {
    // The page checked it already; checked again because this reads the database directly.
    await requireOwner();
    const now = new Date();
    const goals = await selectGoalsFollowing(getDb(), { kind: "habit", id: habit.id }, now);
    return <LinkedGoalsSection sourceName={habit.name} goals={goals} today={ownerDateKey(now)} />;
  },
};

export const projectGoalsSection: ProjectSection = {
  id: "goals",
  async render({ project }) {
    await requireOwner();
    const now = new Date();
    const goals = await selectGoalsFollowing(getDb(), { kind: "project", id: project.id }, now);
    return <LinkedGoalsSection sourceName={project.name} goals={goals} today={ownerDateKey(now)} />;
  },
};
