"use client";

// `finance` offers the quick capture's "Gasto" (SPEC-finance "Captura rápida"): its sheet, handed
// to the shell's extension point (src/lib/quick-capture.ts) by the composition root,
// src/lib/capture-providers.tsx.
import dynamic from "next/dynamic";
import type { CaptureProvider } from "@/lib/quick-capture";

// Fetched when the capture key is pointed at, focused or touched; never with the shell.
const loadSheet = () => import("./components/expense-capture-sheet");
const ExpenseCaptureSheet = dynamic(
  () => loadSheet().then((loaded) => loaded.ExpenseCaptureSheet),
  { ssr: false },
);

export const financeCaptureProvider: CaptureProvider = {
  id: "finance",
  label: "Gasto",
  Sheet: ExpenseCaptureSheet,
  preload: () => void loadSheet(),
};
