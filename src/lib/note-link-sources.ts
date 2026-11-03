// Composition root of the `[[` link sources (SPEC-notes "Contratos → Fuentes de enlace"): the one
// place that knows which modules a note can link to, like EXPORTABLE_TABLES for the export. `notes`
// declares the contract (`NoteLinkSource`) and receives this list as an argument; the modules
// export plain data functions and import nothing of `notes` (eslint.config.mjs).
//
// Every source is imported BY NAME and listed here: no registry filled by side-effect imports
// (package.json declares every JS module free of side effects and the bundler would drop them; see
// capture-providers.tsx and progress-sources.ts).
import "server-only";
import { resolveGoalLinkTargets, searchGoalLinkTargets } from "@/modules/goals/note-link-source";
import { resolveHabitLinkTargets, searchHabitLinkTargets } from "@/modules/habits/note-link-source";
import {
  resolveTrackLinkTargets,
  searchTrackLinkTargets,
} from "@/modules/learning/note-link-source";
import type { NoteLinkSource } from "@/modules/notes/contracts";
import { NOTES_COPY } from "@/modules/notes/copy";
import { resolveNoteLinkTargets, searchNoteLinkTargets } from "@/modules/notes/links";
import {
  resolveProjectLinkTargets,
  searchProjectLinkTargets,
} from "@/modules/projects/note-link-source";
import { resolveTaskLinkTargets, searchTaskLinkTargets } from "@/modules/tasks/note-link-source";
import { ownerDateKey } from "./time";

const LABELS = NOTES_COPY.linkTypeLabels;

/** The six sources, in the picker's order (SPEC-notes "Enlaces"). */
export const NOTE_LINK_SOURCES: readonly NoteLinkSource[] = [
  {
    type: "note",
    label: LABELS.note,
    // A daily note is named by its long date, with the year only when it isn't this year.
    search: (db, q, limit) => searchNoteLinkTargets(db, q, limit, ownerDateKey(new Date())),
    resolve: (db, ids) => resolveNoteLinkTargets(db, ids, ownerDateKey(new Date())),
  },
  {
    type: "project",
    label: LABELS.project,
    search: searchProjectLinkTargets,
    resolve: resolveProjectLinkTargets,
  },
  {
    type: "task",
    label: LABELS.task,
    search: searchTaskLinkTargets,
    resolve: resolveTaskLinkTargets,
  },
  {
    type: "habit",
    label: LABELS.habit,
    search: searchHabitLinkTargets,
    resolve: resolveHabitLinkTargets,
  },
  {
    type: "goal",
    label: LABELS.goal,
    search: searchGoalLinkTargets,
    resolve: resolveGoalLinkTargets,
  },
  {
    type: "learning",
    label: LABELS.learning,
    search: searchTrackLinkTargets,
    resolve: resolveTrackLinkTargets,
  },
];
