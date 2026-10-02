"use client";

// `tasks` owns the quick capture (SPEC-tasks "Captura rápida"): it registers its sheet with the
// shell's extension point (src/lib/quick-capture.ts) when this file loads. Loaded by the
// composition root, src/lib/capture-providers.tsx.
import dynamic from "next/dynamic";
import { registerCaptureProvider } from "@/lib/quick-capture";

// The sheet (form, pickers, the actions' client) is fetched when the key is pointed at, focused
// or touched, so it is usually there by the time it opens; never with the shell.
const loadSheet = () => import("./components/quick-capture-sheet");
const QuickCaptureSheet = dynamic(() => loadSheet().then((loaded) => loaded.QuickCaptureSheet), {
  ssr: false,
});

registerCaptureProvider({
  id: "tasks",
  Sheet: QuickCaptureSheet,
  preload: () => void loadSheet(),
});
