"use client";

import { useEffect, useRef } from "react";
import { CREATED_PARAM } from "@/modules/projects/routes";

type CreatedNoticeProps = {
  /** Id of the page's `<h1 tabIndex={-1}>`. */
  headingId: string;
  message: string;
};

/**
 * Right after creating a project (the page got `?created=1`): focus goes to the page's heading
 * (the sheet and the key that opened it are gone), a status region says it was created, and the
 * parameter leaves the URL so a reload doesn't repeat it.
 */
export function CreatedNotice({ headingId, message }: CreatedNoticeProps) {
  const region = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    document.getElementById(headingId)?.focus();
    const url = new URL(window.location.href);
    if (url.searchParams.has(CREATED_PARAM)) {
      url.searchParams.delete(CREATED_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }
    // A live region only speaks what changes after it is on the page.
    const timer = window.setTimeout(() => {
      if (region.current) region.current.textContent = message;
    }, 150);
    return () => window.clearTimeout(timer);
  }, [headingId, message]);

  return <p ref={region} role="status" className="sr-only" data-created-notice />;
}
