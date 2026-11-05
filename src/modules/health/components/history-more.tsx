"use client";

// «Ver más» of an exercise's history (E3). The next page comes from the server (`?n=`, replacing
// the history entry so Back leaves the page), and this stays mounted across it: when the new rows
// arrive, focus goes to the first new one (the link itself may be gone on the last page) and the
// announcer says how many are shown. Without a new row, focus goes to the history's heading.
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { RECORDS_COPY as COPY } from "../records-copy";

type HistoryMoreProps = {
  /** The next page's URL, or null when everything is shown. */
  href: string | null;
  /** How many sessions the history shows now, and how many there are. */
  shown: number;
  total: number;
  /** Id of the history's heading (tabIndex -1) and of its list. */
  headingId: string;
  listId: string;
};

export function HistoryMore({ href, shown, total, headingId, listId }: HistoryMoreProps) {
  const { announce } = useRequiredScreenServices();
  // The index of the first row the click asked for; null while nothing is loading.
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const first = pending.current;
    if (first === null || shown <= first) return;
    pending.current = null;
    const rows = document.querySelectorAll<HTMLElement>(`#${CSS.escape(listId)} > li a`);
    const target = rows[first] ?? document.getElementById(headingId);
    target?.focus();
    announce(COPY.historyShown(shown, total));
  }, [shown, total, headingId, listId, announce]);

  if (href === null) return null;
  return (
    <Link
      href={href}
      replace
      scroll={false}
      onClick={(event) => {
        if (pending.current !== null) {
          event.preventDefault();
          return;
        }
        pending.current = shown;
      }}
      className="bo-text-body-sm flex min-h-11 w-fit items-center rounded-md px-1 font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      data-exercise-history-more=""
    >
      {COPY.seeMore}
    </Link>
  );
}
