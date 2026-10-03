// The keys of the advisory locks of `projects` (projects.ts, milestones.ts and project-links.ts
// document the rules). Plain constants, no server-only: scripts (`pnpm db:demo`) take the same
// locks without importing server code.

/** First key of every advisory lock `projects` takes (its namespace among the app's locks). */
export const PROJECTS_ADVISORY_SPACE = 2_000;

/** Second key space of `projects` (`PROJECTS_ADVISORY_SPACE` is the dependency graph's). */
export const MILESTONES_ADVISORY_SPACE = PROJECTS_ADVISORY_SPACE + 1;

/** Second key of the dependency graph's lock, in `PROJECTS_ADVISORY_SPACE`. */
export const PROJECT_DEPENDENCIES_KEY = "project_dependencies";

/** First key of a project's links lock: `(hashtext(PROJECT_LINKS_KEY), hashtext(<project>))`. */
export const PROJECT_LINKS_KEY = "project_links";
