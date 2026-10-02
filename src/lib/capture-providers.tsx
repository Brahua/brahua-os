"use client";

// Composition root of the quick capture (SPEC-tasks; extension point in ./quick-capture.ts): the
// one place that knows which module owns the capture, like EXPORTABLE_TABLES for the export. The
// app layout and the signed-in 404 wrap the shell with `CaptureRoot`. `core` never imports the
// provider.
//
// The provider is imported by name and passed down, never registered by a side-effect-only
// `import "…"`: package.json declares every JS module free of side effects ("sideEffects":
// ["*.css"]), so the bundler drops such imports (it did, in the first version of T1).
import { tasksCaptureProvider } from "@/modules/tasks/capture-provider";
import { QuickCaptureContext } from "./quick-capture";

/** Gives the shell (navigation keys and the `C` shortcut) the quick capture of `tasks`. */
export function CaptureRoot({ children }: { children: React.ReactNode }) {
  return <QuickCaptureContext value={tasksCaptureProvider}>{children}</QuickCaptureContext>;
}
