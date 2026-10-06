"use client";

// Composition root of the quick capture (SPEC-tasks, SPEC-finance; extension point in
// ./quick-capture.ts): the one place that knows which modules offer a capture and in which order,
// like EXPORTABLE_TABLES for the export. The app layout and the signed-in 404 wrap the shell with
// `CaptureRoot`. `core` never imports the providers.
//
// The providers are imported by name and passed down, never registered by a side-effect-only
// `import "…"`: package.json declares every JS module free of side effects ("sideEffects":
// ["*.css"]), so the bundler drops such imports (it did, in the first version of T1).
import { financeCaptureProvider } from "@/modules/finance/capture-provider";
import { tasksCaptureProvider } from "@/modules/tasks/capture-provider";
import { QuickCaptureContext, type CaptureProvider } from "./quick-capture";

/** In the switch's order: "Tarea" first (the default until the owner picks another). */
const PROVIDERS: readonly CaptureProvider[] = [tasksCaptureProvider, financeCaptureProvider];

/** Gives the shell (navigation keys and the `C` shortcut) the quick captures of the modules. */
export function CaptureRoot({ children }: { children: React.ReactNode }) {
  return <QuickCaptureContext value={PROVIDERS}>{children}</QuickCaptureContext>;
}
