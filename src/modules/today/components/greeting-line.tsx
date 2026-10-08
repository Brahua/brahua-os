"use client";

import type { DayPart } from "@/lib/time";
import { eveningClose } from "../evening-close";
import { greetingLine } from "../greeting";
import { useTodayProgress } from "./today-progress";

/**
 * The line under the greeting: static text (no `aria-live`; "Día completo" is the one that
 * announces), chosen from the board's live tally so it never contradicts the board. `part` comes
 * from the server (Lima time), so server and client agree. The paragraph is always there with its
 * height reserved (two lines on a phone, one from `md`), so a line appearing or leaving never
 * moves the page; no animation. Outside a board it renders nothing. `closing`: the page was read
 * from 20:00 (evening-close-ritual).
 */
export function GreetingLine({ part, closing = false }: { part: DayPart; closing?: boolean }) {
  const progress = useTodayProgress();
  // In the close of the day (20:00 on), when it has something to say, the close speaks instead.
  const closes = closing && progress !== null && eveningClose(progress.tally) !== null;
  const line =
    progress && !closes
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
