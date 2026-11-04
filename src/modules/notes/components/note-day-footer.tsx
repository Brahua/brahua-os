// «Ese día» (SPEC-notes "Pie", N3): at the end of a daily note, what happened in the app that day,
// read-only: «Ese día: 4 tareas hechas · 3 hábitos cumplidos», or «Sin registros ese día» in a
// neutral tone. Never what was missing. No hooks: rendered by the page (through
// src/lib/note-extensions.tsx, which reads the counts from `tasks` and `habits`).
import { dayFooterText, NOTES_COPY as COPY } from "../copy";

export function NoteDayFooter({
  tasksDone,
  habitsDone,
}: {
  tasksDone: number;
  habitsDone: number;
}) {
  const empty = tasksDone === 0 && habitsDone === 0;
  return (
    // The note's own footer (the page's `article` holds it): one line, no heading of its own.
    <footer className="border-t border-border pt-4" data-note-day-footer="">
      <p className="bo-text-body-sm text-text-secondary">
        {empty ? (
          COPY.dayFooterEmpty
        ) : (
          <>
            <span className="font-semibold text-text">{COPY.dayFooterTitle}:</span>{" "}
            {dayFooterText(tasksDone, habitsDone)}
          </>
        )}
      </p>
    </footer>
  );
}
