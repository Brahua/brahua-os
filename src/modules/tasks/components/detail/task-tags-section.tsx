"use client";

import { startTransition, useId, useOptimistic } from "react";
import { SectionLabel } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { setTaskTags } from "../../tag-actions";
import type { TaskItem } from "../../task-input";
import { TAGS_COPY } from "../../tags-copy";
import { TASKS_COPY } from "../../tasks-copy";
import { TagInput } from "../tag-input";
import { failureReason } from "../tasks-screen";
import { useKnownTags } from "../use-known-tags";
import { useTaskDetail } from "./task-detail-context";

/**
 * Etiquetas (T4): add (Enter or a comma, with suggestions) and remove; each change saves the
 * whole set through `setTaskTags`, shown at once and rolled back if refused. Saves go through the
 * screen's queue with the key `task-tags:<id>`: a burst sends the one in flight and then the last.
 */
export function TaskTagsSection() {
  const { task, host, enqueue, adopt, reportError } = useTaskDetail();
  const ids = useId();
  const headingId = `${ids}-heading`;
  const known = useKnownTags();
  const saved = task.tags.map((tag) => tag.name);
  const [shown, show] = useOptimistic<string[], string[]>(saved, (_, next) => next);

  function save(next: string[]) {
    const id = task.id;
    startTransition(async () => {
      show(next);
      const queued = await enqueue(`task-tags:${id}`, () => setTaskTags({ id, tags: next }));
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        adopt(queued.value.data);
        return;
      }
      const reason =
        queued.kind === "threw"
          ? TASKS_COPY.checkConnection
          : failureReason(queued.value as Extract<ActionResult<TaskItem>, { ok: false }>);
      reportError(`${TASKS_COPY.notSaved(TAGS_COPY.fieldName)} ${reason}`);
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" data-task-tags="">
      <SectionLabel id={headingId} as={host === "sheet" ? "h3" : "h2"} title={TAGS_COPY.label} />
      <TagInput
        id={`${ids}-input`}
        label={TAGS_COPY.inputLabel}
        labelHidden
        value={shown}
        known={known}
        onValueChange={save}
      />
    </section>
  );
}
