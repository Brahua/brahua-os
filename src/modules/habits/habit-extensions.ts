// Extension point of the habit page for other modules (G3 of `goals`, SPEC-goals "Contratos").
// `goals` depends on `habits`, never the other way: a module that has something to show on a
// habit's page registers a section and the page renders what is registered. Pure (types and the
// registry factory, the same shape as `projects/project-extensions.ts`); the app's registry lives
// in contracts.ts (server-only), and the composition root that registers the providers is
// src/lib/goal-extensions.ts.

/** What a section gets of the habit whose page it is on. */
export type HabitSectionContext = {
  habit: { id: string; name: string; archived: boolean };
};

/**
 * A section another module adds to a habit's page (under its detail). `render` runs on the server
 * after the page checked the owner and found the habit: it may read what it needs and returns the
 * section, or null for nothing (a Server Component tree).
 */
export type HabitSection = {
  /** Stable id of the provider (e.g. "goals"). Registering the same id again replaces it. */
  id: string;
  render(context: HabitSectionContext): React.ReactNode | Promise<React.ReactNode>;
};

export type HabitSectionRegistry = {
  /** Adds `section`, or replaces the one with its id. Returns a function that removes it. */
  register(section: HabitSection): () => void;
  size(): number;
  /** Every section rendered for the habit, in registration order (in parallel). */
  render(context: HabitSectionContext): Promise<{ id: string; node: React.ReactNode }[]>;
};

export function createHabitSectionRegistry(): HabitSectionRegistry {
  const sections = new Map<string, HabitSection>();
  return {
    register(section) {
      sections.set(section.id, section);
      return () => {
        if (sections.get(section.id) === section) sections.delete(section.id);
      };
    },
    size: () => sections.size,
    async render(context) {
      const all = [...sections.values()];
      const nodes = await Promise.all(all.map((section) => section.render(context)));
      return all.map((section, index) => ({ id: section.id, node: nodes[index] }));
    },
  };
}
