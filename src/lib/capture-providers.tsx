"use client";

// Composition root of the quick capture (SPEC-tasks; extension point in ./quick-capture.ts). The
// module that owns the capture registers its provider when its file loads; importing it here,
// in the same file that hands the provider to the shell, guarantees it is registered before the
// shell renders (on the server and in the browser). The app layout and the signed-in 404 wrap
// the shell with `CaptureRoot`. `core` never imports the provider.
import { currentCaptureProvider, QuickCaptureContext } from "./quick-capture";
import "@/modules/tasks/capture-provider";

/** Gives the shell (navigation keys and the `C` shortcut) the registered capture provider. */
export function CaptureRoot({ children }: { children: React.ReactNode }) {
  return <QuickCaptureContext value={currentCaptureProvider()}>{children}</QuickCaptureContext>;
}
