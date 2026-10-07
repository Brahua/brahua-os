"use client";

import { ChevronDown, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { CapturePreview } from "@/modules/core/components/capture-preview";
import { useAnnouncer } from "@/modules/core/components/screen-services";
import { Icon, Key, Sheet, TextField } from "@/design-system";
import { fail, type ActionResult, type FieldErrors } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import type { CaptureSheetProps } from "@/lib/quick-capture";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { createTask, listTaskTargets } from "../actions";
import { readCaptureTitle, type CaptureReading } from "../capture-text";
import { INBOX_VALUE, placementName, toPlacement, type PlacementValue } from "../placement";
import type { TaskPriority } from "../task-constants";
import { createTaskInputSchema, type TaskItem, type TaskTargets } from "../task-input";
import { TAGS_COPY } from "../tags-copy";
import { TASKS_COPY } from "../tasks-copy";
import {
  draftFromRule,
  ruleFromDraft,
  type RecurrenceDraft,
  type RecurrenceDraftErrors,
} from "../recurrence-draft";
import { DateField } from "./date-field";
import { PlacementSelect } from "./placement-select";
import { PriorityPicker } from "./priority-picker";
import { RecurrenceEditor } from "./recurrence-editor";
import { TagInput } from "./tag-input";
import { useKnownTags } from "./use-known-tags";

/** The server's errors on the recurrence rule (`recurrence.<field>`). */
function recurrenceErrorsOf(fieldErrors: FieldErrors | undefined): RecurrenceDraftErrors {
  const errors: RecurrenceDraftErrors = {};
  for (const field of ["interval", "weekdays", "monthDay"] as const) {
    const message = fieldErrors?.[`recurrence.${field}`]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

type Field = "title" | "placement" | "dueDate" | "priority" | "tags";
type Errors = Partial<Record<Field, string>>;

/** The server's field errors on the capture's own fields (area/project/milestone → placement). */
function errorsOf(fieldErrors: FieldErrors | undefined): Errors {
  const first = (key: string) => fieldErrors?.[key]?.[0];
  const errors: Errors = {};
  const title = first("title");
  const placement = first("lifeAreaId") ?? first("projectId") ?? first("milestoneId");
  const dueDate = first("dueDate");
  const priority = first("priority");
  // T4: "tags" or "tags.<n>" (one of them).
  const tags = Object.entries(fieldErrors ?? {}).find(([key]) => key.split(".")[0] === "tags")?.[1][0];
  if (title) errors.title = title;
  if (placement) errors.placement = placement;
  if (dueDate) errors.dueDate = dueDate;
  if (priority) errors.priority = priority;
  if (tags) errors.tags = tags;
  return errors;
}

const FIELD_ORDER: Field[] = ["title", "placement", "dueDate", "priority", "tags"];

/**
 * Quick capture (SPEC-tasks: under 10 s on the phone). The title has focus; area or project and
 * the due date are visible from the start and optional (empty: the inbox); priority waits under
 * "Más detalles". Enter saves; the field is then empty and focused for the next one, and a
 * polite status says where it went. Not optimistic: it waits for the server (a few hundred ms),
 * so nothing is lost if the save fails — the text stays in the field with the reason.
 */
export function QuickCaptureSheet({
  open,
  onOpenChange,
  returnFocusRef,
  switcher,
}: CaptureSheetProps) {
  const isDesktop = useIsDesktop();
  const ids = useId();
  const formId = `${ids}-form`;
  const detailsId = `${ids}-details`;
  const priorityLabelId = `${ids}-priority`;

  const [title, setTitle] = useState("");
  const [placement, setPlacement] = useState<PlacementValue>(INBOX_VALUE);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [tags, setTags] = useState<string[]>([]);
  const knownTags = useKnownTags();
  const [detailsOpen, setDetailsOpen] = useState(false);
  // polish → capture-nl-dates: what the title says ("pilas mañana"), refreshed as the owner types,
  // and whether they cancelled it for this entry (the text then stays as typed).
  const [reading, setReading] = useState<CaptureReading | null>(null);
  const [readingOff, setReadingOff] = useState(false);
  // T3: the recurrence rule (none by default), its errors shown after a submit.
  // Lima's "today" for the editor: refreshed when "Más detalles" opens (the editor shows only
  // then) and after each save, so a sheet kept open past midnight doesn't use yesterday.
  const [now, setNow] = useState(() => new Date());
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(() => draftFromRule(null, now));
  const [recurrenceShowErrors, setRecurrenceShowErrors] = useState(false);
  const [recurrenceServerErrors, setRecurrenceServerErrors] = useState<RecurrenceDraftErrors>({});
  const recurrenceRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [announcement, announce] = useAnnouncer();
  const [pending, startTransition] = useTransition();

  const [targets, setTargets] = useState<TaskTargets | null>(null);
  const [targetsFailed, setTargetsFailed] = useState(false);

  const titleInput = useRef<HTMLInputElement>(null);
  const placementSelect = useRef<HTMLSelectElement>(null);
  const dueInput = useRef<HTMLInputElement>(null);
  // The latest title, to know after an await whether the owner kept typing.
  const titleNow = useRef(title);
  const focusFirstInvalid = useRef(false);

  // Where a task can go, fresh at every opening (a project created a minute ago is there).
  useEffect(() => {
    let current = true;
    listTaskTargets({})
      .then((result) => {
        if (!current) return;
        if (result.ok) setTargets(result.data);
        else setTargetsFailed(true);
      })
      .catch(() => {
        if (current) setTargetsFailed(true);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!focusFirstInvalid.current) return;
    focusFirstInvalid.current = false;
    const first = FIELD_ORDER.find((field) => errors[field]);
    const target =
      first === "title"
        ? titleInput.current
        : first === "placement"
          ? placementSelect.current
          : first === "dueDate"
            ? dueInput.current
            : first === "tags"
              ? document.getElementById(`${ids}-tags`)
              : null;
    // After the commit settles: a select focused mid-commit stalled the transition in jsdom.
    // (No cleanup: the next render would cancel it.)
    window.setTimeout(() => target?.focus(), 0);
  });

  /** A rule that can't be saved yet: open "Más detalles", show why and go there. */
  function showRecurrenceErrors(errors: RecurrenceDraftErrors) {
    setDetailsOpen(true);
    setRecurrenceShowErrors(true);
    const first = errors.interval ?? errors.weekdays ?? errors.monthDay;
    if (first) announce(first);
    // After the commit (the details were hidden): the invalid field, or the first weekday.
    window.setTimeout(() => {
      recurrenceRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-weekday]')
        ?.focus();
    }, 0);
  }

  function showErrors(result: { error: string; fieldErrors?: FieldErrors }) {
    const serverRecurrence = recurrenceErrorsOf(result.fieldErrors);
    if (Object.keys(serverRecurrence).length > 0) {
      setRecurrenceServerErrors(serverRecurrence);
      showRecurrenceErrors(serverRecurrence);
      return;
    }
    const fieldErrors = errorsOf(result.fieldErrors);
    focusFirstInvalid.current = true;
    setErrors(fieldErrors);
    if (fieldErrors.priority || fieldErrors.tags) setDetailsOpen(true);
    setFormError(Object.keys(fieldErrors).length > 0 ? null : result.error);
    // Enter leaves focus in the title, so moving focus there says nothing: the first field error
    // is read through the sheet's status region (the general error is a role="alert" below).
    const first = FIELD_ORDER.map((field) => fieldErrors[field]).find(Boolean);
    if (first) announce(first);
  }

  function clearError(field: Field) {
    if (!errors[field]) return;
    setErrors((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  // While saving, the sheet stays open (closing would lose the answer).
  function requestOpenChange(next: boolean) {
    if (!next && pending) return;
    onOpenChange(next);
  }

  function reread(text: string, manualDate: string) {
    setReading(readCaptureTitle(text, new Date(), manualDate));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const rule = ruleFromDraft(recurrence);
    // The reading is made again now (the clock moved since the last key); cancelled: as typed.
    const understood = readingOff ? null : readCaptureTitle(title, new Date(), dueDate);
    const parsed = createTaskInputSchema.safeParse({
      title: understood?.title ?? title,
      ...toPlacement(placement),
      dueDate: understood?.dueDate ?? dueDate,
      ...(understood?.dueTime ? { dueTime: understood.dueTime } : {}),
      priority,
      // Only a rule is sent (none: the field is left out).
      recurrence: rule.ok && rule.rule ? rule.rule : undefined,
      // Only with some: a capture without tags sends what it did before T4.
      ...(tags.length > 0 ? { tags } : {}),
    });
    if (!parsed.success) {
      const failed = fail(parsed.error);
      if (!failed.ok) showErrors(failed);
      return;
    }
    if (!rule.ok) {
      showRecurrenceErrors(rule.errors);
      return;
    }
    setFormError(null);
    const sentTitle = title;
    const where = placementName(targets, placement);
    startTransition(async () => {
      let result: ActionResult<TaskItem>;
      try {
        result = await createTask(parsed.data);
      } catch {
        // Network failure or a new deployment: the action itself never throws.
        result = fail(TASKS_COPY.checkConnection);
      }
      if (!result.ok) {
        showErrors(result);
        return;
      }
      // Ready for the next one: empty (unless the owner already typed another), back to the inbox.
      if (titleNow.current === sentTitle) {
        titleNow.current = "";
        setTitle("");
      }
      // The next entry (empty, or what the owner already typed while saving) starts uncancelled.
      setReadingOff(false);
      reread(titleNow.current, "");
      setPlacement(INBOX_VALUE);
      setDueDate("");
      setPriority("medium");
      const savedAt = new Date();
      setNow(savedAt);
      setRecurrence(draftFromRule(null, savedAt));
      setRecurrenceShowErrors(false);
      setRecurrenceServerErrors({});
      setTags([]);
      setErrors({});
      titleInput.current?.focus();
      announce(where ? TASKS_COPY.addedTo(where) : TASKS_COPY.addedToInbox);
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={requestOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={TASKS_COPY.captureTitle}
      returnFocusRef={returnFocusRef}
      initialFocusRef={titleInput}
      closeDisabled={pending}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={pending || undefined}
            onClick={() => requestOpenChange(false)}
          >
            {TASKS_COPY.close}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={pending || undefined}
            shortcut={isDesktop ? "↵" : undefined}
          >
            {pending ? TASKS_COPY.adding : TASKS_COPY.add}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-5"
        data-quick-capture=""
        data-saving={pending ? "" : undefined}
      >
        {/* The shell's "Tarea · Gasto" switch, when another module offers a capture too. */}
        {switcher}

        <TextField
          ref={titleInput}
          id={`${ids}-title`}
          label={TASKS_COPY.captureTitleLabel}
          name="title"
          value={title}
          autoComplete="off"
          enterKeyHint="done"
          required
          error={errors.title}
          help={TASKS_COPY.captureTitleHelp}
          onKeyDown={(event) => {
            // Enter saves from the title even though the submit key lives in the sheet's footer
            // (outside the form): not left to implicit submission.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          onChange={(event) => {
            titleNow.current = event.target.value;
            setTitle(event.target.value);
            reread(event.target.value, dueDate);
            if (event.target.value.trim() === "") setReadingOff(false);
            clearError("title");
          }}
        />

        {/* The reading of the title; a touch cancels it and focus goes back to the field. */}
        <CapturePreview
          className="-mt-2"
          summary={readingOff ? null : (reading?.summary ?? null)}
          spoken={reading ? TASKS_COPY.nlSpoken(reading.summary) : ""}
          removeText={TASKS_COPY.nlRemove}
          onRemove={() => {
            setReadingOff(true);
            titleInput.current?.focus();
          }}
        />

        <PlacementSelect
          ref={placementSelect}
          id={`${ids}-placement`}
          targets={targets}
          value={placement}
          onValueChange={(value) => {
            setPlacement(value);
            clearError("placement");
          }}
          help={
            targetsFailed
              ? TASKS_COPY.placementLoadFailed
              : targets
                ? undefined
                : TASKS_COPY.placementLoading
          }
          error={errors.placement}
        />

        <DateField
          ref={dueInput}
          id={`${ids}-due`}
          label={TASKS_COPY.dueLabel}
          value={dueDate}
          help={TASKS_COPY.dueHelp}
          error={errors.dueDate}
          onChange={(event) => {
            setDueDate(event.target.value);
            reread(title, event.target.value);
            clearError("dueDate");
          }}
        />

        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="bo-text-body-sm flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-md font-semibold text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => {
              if (!detailsOpen) {
                const openedAt = new Date();
                setNow(openedAt);
                // Without a rule yet, its defaults (today's weekday and day) follow today.
                if (recurrence.mode === "none") setRecurrence(draftFromRule(null, openedAt));
              }
              setDetailsOpen((value) => !value);
            }}
          >
            <Icon icon={ChevronDown} size="sm" className={cn(detailsOpen && "rotate-180")} />
            {TASKS_COPY.moreDetails}
          </button>
          <div id={detailsId} hidden={!detailsOpen} className="flex flex-col gap-5">
            <div className={cn("bo-field", errors.priority && "is-error")}>
              <span id={priorityLabelId} className="bo-field__label">
                {TASKS_COPY.priorityLabel}
              </span>
              <PriorityPicker
                value={priority}
                onValueChange={(value) => {
                  setPriority(value);
                  clearError("priority");
                }}
                labelledBy={priorityLabelId}
              />
            </div>
            <TagInput
              id={`${ids}-tags`}
              label={TAGS_COPY.label}
              value={tags}
              known={knownTags}
              error={errors.tags}
              onValueChange={(next) => {
                setTags(next);
                clearError("tags");
              }}
            />

            <div ref={recurrenceRef}>
              <RecurrenceEditor
                id={`${ids}-recurrence`}
                draft={recurrence}
                now={now}
                dueDate={dueDate || null}
                showErrors={recurrenceShowErrors}
                serverErrors={recurrenceServerErrors}
                onDraftChange={(next) => {
                  setRecurrence(next);
                  setRecurrenceServerErrors({});
                }}
              />
            </div>
          </div>
        </div>

        {formError ? (
          <p role="alert" className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {formError}
          </p>
        ) : null}
        {/* Polite: "Agregando…" while saving, then where it went. */}
        <p role="status" className="sr-only" data-capture-status="">
          {pending ? TASKS_COPY.addingStatus : announcement}
        </p>
      </form>
    </Sheet>
  );
}
