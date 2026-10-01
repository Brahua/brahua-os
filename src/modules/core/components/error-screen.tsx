"use client";

import { RotateCcw, Sun } from "lucide-react";
import { useEffect, useRef } from "react";
import { Icon, Key } from "@/design-system";
import { STATUS_COPY } from "@/modules/core/copy";
import { StatusScreen } from "./status-screen";

export type ErrorScreenProps = {
  /** Only the digest is read: never the message or the stack. */
  error: Error & { digest?: string };
  /** Next 16 `retry()`: re-fetches and re-renders the segment that failed. */
  retry: () => void;
};

/**
 * Content of every error boundary (`error.tsx`, `global-error.tsx`). Blame-free and without
 * technical details: in production Next replaces a Server Component error's message with a
 * generic one anyway, and a Client Component error keeps its original message, so the message is
 * never rendered. The digest (an opaque hash that matches the server log) is shown as a small code.
 */
export function ErrorScreen({ error, retry }: ErrorScreenProps) {
  const copy = STATUS_COPY.error;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The page under the cursor changed without a navigation: move the focus to the heading so
  // keyboard and screen reader users land on the explanation.
  useEffect(() => {
    headingRef.current?.focus();
  }, [error]);

  return (
    <>
      {/* React hoists it into <head> and removes it with this screen, so a successful retry
          gets the page's own title back. */}
      <title>{copy.title}</title>
      <StatusScreen
        lcdTag={copy.lcdTag}
        lcdText={copy.lcd}
        heading={copy.heading}
        description={copy.description}
        headingRef={headingRef}
        footnote={
          error.digest ? (
            <p className="bo-text-label break-all text-text-secondary">{copy.code(error.digest)}</p>
          ) : null
        }
      >
        <Key variant="signal" icon={RotateCcw} onClick={() => retry()}>
          {copy.retry}
        </Key>
        {/* A full load, not a client navigation: the app state that failed starts over. */}
        <Key asChild>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the full load is the point */}
          <a href="/">
            <Icon icon={Sun} />
            {STATUS_COPY.backHome}
          </a>
        </Key>
      </StatusScreen>
    </>
  );
}
