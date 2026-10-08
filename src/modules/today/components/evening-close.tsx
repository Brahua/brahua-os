"use client";

import NumberFlow from "@number-flow/react";
import { Moon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon, Key } from "@/design-system";
import { useRequiredScreenServices } from "@/modules/core/components/screen-services";
import { closeQuestion, eveningClose, msUntilEveningClose } from "../evening-close";
import { TODAY_HEADING_ID } from "../today-board";
import { TODAY_COPY } from "../today-copy";
import { usePostponeAll, useTodayProgress } from "./today-progress";

const COPY = TODAY_COPY.eveningClose;

/**
 * Before 20:00 (Lima) the board waits for the hour and reads the page again once when it comes,
 * so a board left open from the afternoon turns into the close by itself. The timer is cleared on
 * unmount; it sets no state.
 */
export function EveningCloseWatch() {
  const router = useRouter();
  useEffect(() => {
    const wait = msUntilEveningClose(new Date());
    if (wait === null) return;
    const timer = setTimeout(() => router.refresh(), wait);
    return () => clearTimeout(timer);
  }, [router]);
  return null;
}

/**
 * The close of the day (evening-close-ritual), from 20:00 (Lima) when something is left: what was
 * achieved first ("Hoy: 4 hábitos · 3 tareas", the numbers roll with `NumberFlow`), the habits as
 * "4 de 5" (they never move), and one question about the tasks left with "Mañana" (every pending
 * task passes to tomorrow, one notice with "Deshacer") and "Dejar aquí". It follows the board's
 * live tally: the question leaves the moment the last task does. Static text, no live region of
 * its own (the board's announcer says what a key did). Focus: when the question leaves because a
 * key was pressed, focus goes to the close's heading, else the board's.
 */
export function EveningClose() {
  const progress = useTodayProgress();
  const postponeAll = usePostponeAll();
  const { announce } = useRequiredScreenServices();
  const [kept, setKept] = useState(false);
  const questionId = useId();
  const refocus = useRef(false);

  const close = progress ? eveningClose(progress.tally) : null;
  const asking = close !== null && close.pending > 0 && !kept;

  // The key that was pressed unmounts with the question: focus goes on to something that exists.
  useLayoutEffect(() => {
    if (asking || !refocus.current) return;
    refocus.current = false;
    (
      document.getElementById("today-evening-title") ?? document.getElementById(TODAY_HEADING_ID)
    )?.focus();
  }, [asking]);

  if (!progress || !close) return null;

  const parts: { value: number; one: string; many: string }[] = [];
  if (close.habits > 0) parts.push({ value: close.habits, one: " hábito", many: " hábitos" });
  if (close.tasks > 0) parts.push({ value: close.tasks, one: " tarea", many: " tareas" });
  const spoken = parts.map(({ value, one, many }) => `${value}${value === 1 ? one : many}`);

  function tomorrow() {
    if (!postponeAll) return;
    refocus.current = true;
    postponeAll();
  }

  function keep() {
    refocus.current = true;
    setKept(true);
    // Nothing is saved: the tasks stay where they are, the question just goes away.
    announce(COPY.kept);
  }

  return (
    <section
      aria-labelledby="today-evening-title"
      className="bo-card max-w-160 items-start"
      data-evening-close=""
    >
      <Icon icon={Moon} size="xl" className="text-text-secondary" />
      <h2 id="today-evening-title" tabIndex={-1} className="bo-text-title outline-none">
        {COPY.title}
      </h2>
      {parts.length > 0 ? (
        <p className="bo-text-body" data-evening-achieved="">
          <span aria-hidden="true">
            {COPY.achievedPrefix}
            {parts.map((part, index) => (
              <Fragment key={part.one}>
                {index > 0 ? " · " : null}
                <NumberFlow
                  value={part.value}
                  suffix={part.value === 1 ? part.one : part.many}
                  respectMotionPreference
                />
              </Fragment>
            ))}
          </span>
          <span className="sr-only">{COPY.achievedSpoken(spoken)}</span>
        </p>
      ) : null}
      {close.habitsOpen ? (
        <p className="bo-text-label text-text-secondary" data-evening-habits="">
          {COPY.habitsOf(close.habitsOpen.done, close.habitsOpen.total)}
        </p>
      ) : null}
      {asking ? (
        <div className="flex flex-col gap-3" role="group" aria-labelledby={questionId}>
          <p id={questionId} className="bo-text-body" data-evening-question="">
            {closeQuestion(progress.today, close.pending)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Key onClick={tomorrow} data-evening-tomorrow="">
              {COPY.tomorrow}
            </Key>
            <Key variant="ghost" onClick={keep} data-evening-keep="">
              {COPY.keep}
            </Key>
          </div>
        </div>
      ) : null}
    </section>
  );
}
