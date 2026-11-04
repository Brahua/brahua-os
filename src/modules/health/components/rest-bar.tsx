"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Key } from "@/design-system";
import { useSecondClock } from "@/lib/use-second-clock";
import { adjustRest, readRest, restLeft, startRest, writeRest, type Rest } from "../rest-timer";
import { SESSIONS_COPY as COPY } from "../sessions-copy";
import { formatClock } from "../weight";

/** The vibration at zero (Android; iOS has no `navigator.vibrate`). */
const VIBRATION = [200, 100, 200];
/** Where the bar publishes the space it takes (extensions.css lifts the notices above it). */
const OFFSET_VAR = "--rest-bar-offset";
const GAP = 12;

export type RestTimer = {
  rest: Rest | null;
  /** The clock (null on the server and while hydrating: nothing shows then). */
  now: number | null;
  start: (seconds: number) => void;
  adjust: (direction: 1 | -1) => void;
  skip: () => void;
};

/**
 * The rest of a session (SPEC-health "Descanso"): its end instant, kept in sessionStorage so a
 * reload keeps counting. At zero it vibrates where it can and says so through `announce`, once.
 * Ticks with the shared clock (no timer of its own, nothing left running after unmount).
 */
export function useRestTimer(sessionId: string, announce: (message: string) => void): RestTimer {
  // Read on the client's first render; nothing shows until the clock runs (after hydration), so
  // the server's empty HTML still matches.
  const [rest, setRest] = useState<Rest | null>(() =>
    typeof window === "undefined" ? null : readRest(sessionId, Date.now()),
  );
  const now = useSecondClock();
  const over = rest !== null && now !== null && now >= rest.endAt;
  const rung = useRef<number | null>(null);

  useEffect(() => {
    if (!over || rest === null || rung.current === rest.endAt) return;
    rung.current = rest.endAt;
    try {
      navigator.vibrate?.(VIBRATION);
    } catch {
      // Some browsers throw without a user gesture: the announcement still goes.
    }
    announce(COPY.restOver);
    writeRest(sessionId, null);
  }, [over, rest, announce, sessionId]);

  function set(next: Rest | null) {
    setRest(next);
    writeRest(sessionId, next);
  }

  return {
    rest: over ? null : rest,
    now,
    // From the clock's second, so the bar ticks exactly with it (never a second too many).
    start: (seconds) => set(startRest(seconds, now ?? Math.floor(Date.now() / 1000) * 1000)),
    adjust: (direction) => {
      if (rest === null || over) return;
      set(adjustRest(rest, direction, Date.now()));
    },
    skip: () => set(null),
  };
}

type RestBarProps = {
  timer: RestTimer;
  /** Where focus goes when the bar leaves while it holds focus (the set that started it). */
  returnFocus: () => HTMLElement | null;
};

/**
 * The bar at the bottom while resting: the time left, «−15 s», «+15 s» and «Saltar». It never
 * takes focus; when it leaves while one of its keys has it (Saltar, or zero), focus goes back to
 * the set that started it. While shown it publishes its height (`--rest-bar-offset`), so the
 * notices rise above it and a focused control scrolls clear of it.
 */
export function RestBar({ timer, returnFocus }: RestBarProps) {
  const { rest, now } = timer;
  const shown = rest !== null && now !== null;
  const bar = useRef<HTMLElement>(null);
  const focusInside = useRef(false);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const element = bar.current;
    if (!shown || !element) {
      root.style.removeProperty(OFFSET_VAR);
      return;
    }
    const update = () => {
      const height = element.getBoundingClientRect().height;
      root.style.setProperty(OFFSET_VAR, `${height > 0 ? Math.ceil(height) + GAP : 0}px`);
    };
    update();
    // The bar may now cover the focused control (the set just marked): the scroll padding counts
    // it from here on, so bring that control back into view (WCAG 2.4.11).
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !element.contains(active)) {
      active.scrollIntoView?.({ block: "nearest" });
    }
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(OFFSET_VAR);
    };
  }, [shown]);

  // The bar left with focus inside (a removed key gets no blur): don't leave it on <body>.
  useLayoutEffect(() => {
    if (shown || !focusInside.current) return;
    focusInside.current = false;
    const target = returnFocus();
    (target?.isConnected ? target : document.getElementById("content"))?.focus({
      preventScroll: true,
    });
  }, [shown, returnFocus]);

  if (!shown) return null;
  const left = restLeft(rest, now);
  const minutes = Math.floor(left / 60);

  return (
    <section
      ref={bar}
      aria-label={COPY.restRegion}
      className="bo-rest-bar flex flex-wrap items-center gap-2 rounded-lg bg-surface p-3 shadow-popover"
      data-rest-bar=""
      onFocus={() => {
        focusInside.current = true;
      }}
      onBlur={(event) => {
        if (!bar.current?.contains(event.relatedTarget as Node | null)) {
          focusInside.current = false;
        }
      }}
    >
      <p className="flex min-w-0 basis-full items-baseline gap-2 min-[420px]:flex-1 min-[420px]:basis-auto">
        <span className="bo-text-label text-text-secondary">{COPY.rest}</span>
        <span
          role="timer"
          aria-label={COPY.restLeftName(minutes, left % 60)}
          className="bo-text-data-lg tabular-nums"
          data-rest-left={left}
        >
          {formatClock(left)}
        </span>
      </p>
      <div className="ml-auto flex gap-2">
        <Key
          variant="ghost"
          aria-label={COPY.restMinusName}
          data-rest-minus=""
          onClick={() => timer.adjust(-1)}
        >
          {COPY.restMinus}
        </Key>
        <Key
          variant="ghost"
          aria-label={COPY.restPlusName}
          data-rest-plus=""
          onClick={() => timer.adjust(1)}
        >
          {COPY.restPlus}
        </Key>
        <Key variant="signal" aria-label={COPY.restSkipName} data-rest-skip="" onClick={timer.skip}>
          {COPY.restSkip}
        </Key>
      </div>
    </section>
  );
}
