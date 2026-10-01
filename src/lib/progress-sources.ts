// Composition root of the progress sources (SPEC-projects "Contratos con otros módulos"). A
// module that contributes to the progress of projects registers its source at import time
// (registerProgressSource in @/modules/projects/contracts); importing its file here is what
// loads it on the server instance that renders the projects list and detail, which import this
// file for its side effect. `projects` itself never imports the providers: the dependency stays
// `tasks` → `projects`, like the export tables in @/lib/data-export.
//
// When `tasks` exists, add one line (its file calls registerProgressSource at the top level):
//
//   import "@/modules/tasks/progress-source";
import "server-only";
