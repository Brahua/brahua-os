"use client";

// `tasks` owns the quick capture (SPEC-tasks "Captura rápida"): its sheet, offered to the shell's
// extension point (src/lib/quick-capture.ts) by the composition root,
// src/lib/capture-providers.tsx.
import dynamic from "next/dynamic";
import type { CaptureProvider } from "@/lib/quick-capture";

// The sheet (form, pickers, the actions' client) is fetched when the key is pointed at, focused
// or touched, so it is usually there by the time it opens; never with the shell.
const loadSheet = () => import("./components/quick-capture-sheet");
const QuickCaptureSheet = dynamic(() => loadSheet().then((loaded) => loaded.QuickCaptureSheet), {
  ssr: false,
});

export const tasksCaptureProvider: CaptureProvider = {
  id: "tasks",
  Sheet: QuickCaptureSheet,
  preload: () => void loadSheet(),
};
