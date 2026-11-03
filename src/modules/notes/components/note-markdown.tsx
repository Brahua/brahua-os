"use client";

// The Markdown renderer on the client (src/lib/markdown/), only for text that differs from what the
// page rendered on the server (just typed, or another version after a conflict). Loaded on demand:
// a note's page ships no Markdown code of its own until the text changes.
import dynamic from "next/dynamic";
import { NOTES_COPY as COPY } from "../copy";

export const loadMarkdown = () =>
  import("@/lib/markdown/markdown").then((module) => module.Markdown);

export const ClientMarkdown = dynamic(loadMarkdown, {
  ssr: false,
  loading: () => <p className="bo-text-body-sm text-text-secondary">{COPY.previewLoading}</p>,
});
