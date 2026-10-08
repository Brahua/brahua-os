"use client";

import type { DayPart } from "@/lib/time";
import { greetingLine } from "../greeting";
import { useTodayProgress } from "./today-progress";

/**
 * The line under the greeting: static text (no `aria-live`; "Día completo" is the one that
 * announces), chosen from the board's live tally so it never contradicts the board. `part` comes
 * from the server (Lima time), so server and client agree. The paragraph is always there with its
 * height reserved (two lines on a phone, one from `md`), so a line appearing or leaving never
 * moves the page; no animation. Outside a board it renders nothing.
 */
export function GreetingLine({ part }: { part: DayPart }) {
  const progress = useTodayProgress();
  const line = progress
    ? greetingLine({ part, tally: progress.tally, today: progress.today })
    : null;
  return (
    <p
      className="bo-text-body min-h-[2lh] text-text-secondary md:min-h-[1lh]"
      data-greeting-line=""
    >
      {line}
    </p>
  );
}
