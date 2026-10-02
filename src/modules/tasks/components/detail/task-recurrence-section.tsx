"use client";

import { startTransition, useId, useState } from "react";
import { SectionLabel } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { setTaskRecurrence } from "../../recurrence-actions";
import { RECURRENCE_COPY } from "../../recurrence-copy";
import { draftFromRule, ruleFromDraft, sameRule, type RecurrenceDraft } from "../../recurrence-draft";
import type { TaskItem } from "../../task-input";
import { TASKS_COPY } from "../../tasks-copy";
import { RecurrenceEditor } from "../recurrence-editor";
import { failureReason } from "../tasks-screen";
import { useTaskDetail } from "./task-detail-context";

/**
 * "Recurrencia" (T3): the rule editor with its summary. A choice (how it repeats, the unit, a
 * weekday) saves at once; a typed number saves when it is left or with Enter. Saves go through
 * the screen's queue (`task-recurrence:<id>`: a burst sends the one in flight, then the last);
 * a refusal or a network failure puts the saved rule back and says why (`reportError`).
 */
export function TaskRecurrenceSection() {
  const { task, host, now, enqueue, adopt, reportError } = useTaskDetail();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const [draft, setDraft] = useState<RecurrenceDraft>(() => draftFromRule(task.recurrence, now));
  // The last rule sent (or saved): a change back to it sends nothing.
  const [sent, setSent] = useState(task.recurrence);

  function save(next: RecurrenceDraft) {
    const parsed = ruleFromDraft(next);
    if (!parsed.ok || sameRule(parsed.rule, sent)) return;
    const id = task.id;
    const before = task.recurrence;
    setSent(parsed.rule);
    startTransition(async () => {
      const queued = await enqueue(`task-recurrence:${id}`, () =>
        setTaskRecurrence({ id, recurrence: parsed.rule }),
      );
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        adopt(queued.value.data);
        return;
      }
      const reason =
        queued.kind === "threw"
          ? TASKS_COPY.checkConnection
          : failureReason(queued.value as Extract<ActionResult<TaskItem>, { ok: false }>);
      setSent(before);
      setDraft(draftFromRule(before, now));
      reportError(`${TASKS_COPY.notSaved(RECURRENCE_COPY.fieldName)} ${reason}`);
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" data-task-recurrence="">
      <SectionLabel
        id={headingId}
        as={host === "sheet" ? "h3" : "h2"}
        title={RECURRENCE_COPY.label}
      />
      <RecurrenceEditor
        id={`${ids}-recurrence`}
        draft={draft}
        now={now}
        hideLegend
        onDraftChange={(next) => {
          setDraft(next);
          // Typed numbers wait until they are left (`onCommit`); every other change saves.
          const typed = next.interval !== draft.interval || next.monthDay !== draft.monthDay;
          if (!typed) save(next);
        }}
        onCommit={() => save(draft)}
      />
    </section>
  );
}
