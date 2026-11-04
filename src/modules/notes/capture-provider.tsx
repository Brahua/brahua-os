"use client";

// `notes` offers the quick capture's «Nota» (SPEC-notes "Captura «Nota»"): its sheet, handed to the
// shell's extension point (src/lib/quick-capture.ts) by the composition root,
// src/lib/capture-providers.tsx (the only one that imports it: nobody imports `notes`).
import dynamic from "next/dynamic";
import type { CaptureProvider } from "@/lib/quick-capture";

// Fetched when the capture key is pointed at, focused or touched; never with the shell.
const loadSheet = () => import("./components/note-capture-sheet");
const NoteCaptureSheet = dynamic(() => loadSheet().then((loaded) => loaded.NoteCaptureSheet), {
  ssr: false,
});

export const notesCaptureProvider: CaptureProvider = {
  id: "notes",
  // Written here, not read from copy.ts: the provider ships with the shell, the copy doesn't.
  label: "Nota",
  Sheet: NoteCaptureSheet,
  preload: () => void loadSheet(),
};
