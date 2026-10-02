"use client";

// Composition root of the quick capture (SPEC-tasks; extension point in ./quick-capture.ts): the
// one place that knows which module owns the capture, like EXPORTABLE_TABLES for the export. It
// registers the provider when this file loads, in the same file that hands it to the shell, so
// it is registered before the shell renders (on the server and in the browser). The app layout
// and the signed-in 404 wrap the shell with `CaptureRoot`. `core` never imports the provider.
//
// The provider is imported by name and registered here, not by a side-effect-only import of the
// module's file: package.json declares every JS module free of side effects ("sideEffects":
// ["*.css"]), so the bundler drops `import "…"` lines whose exports nobody uses.
import {
  currentCaptureProvider,
  QuickCaptureContext,
  registerCaptureProvider,
} from "./quick-capture";
import { tasksCaptureProvider } from "@/modules/tasks/capture-provider";

registerCaptureProvider(tasksCaptureProvider);

/** Gives the shell (navigation keys and the `C` shortcut) the registered capture provider. */
export function CaptureRoot({ children }: { children: React.ReactNode }) {
  return <QuickCaptureContext value={currentCaptureProvider()}>{children}</QuickCaptureContext>;
}
