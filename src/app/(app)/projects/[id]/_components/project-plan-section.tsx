"use client";

import { Pencil } from "lucide-react";
import { useId, useRef, useState } from "react";
import { IconKey, SectionLabel, TextArea, TextField } from "@/design-system";
import { formatDateKey } from "@/lib/time";
import { updateProjectDates, updateProjectObjective } from "@/modules/projects/actions";
import {
  PROJECT_ERRORS,
  updateProjectDatesInputSchema,
  updateProjectObjectiveInputSchema,
} from "@/modules/projects/project-input";
import { showsDueDate } from "@/modules/projects/project-status";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";
import { EditorForm, fieldErrorsOf, useInlineEditor } from "./inline-editor";
import { useProjectDetail, useSaveProjectField } from "./project-detail-context";

type ProjectPlanSectionProps = {
  /**
   * P3 (Hitos y avance) slot: the progress meter, under the dates. Nothing renders without it
   * (no progress without milestones, nor in Mantenimiento).
   */
  progress?: React.ReactNode;
};

/** "Objetivo y fechas": what done looks like and when, each edited in place. */
export function ProjectPlanSection({ progress }: ProjectPlanSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionLabel id={headingId} as="h2" title={PROJECTS_COPY.planSection} />
      <div className="bo-card gap-6">
        <ObjectiveField />
        <DatesField />
        {progress}
      </div>
    </section>
  );
}

/** A labeled value with its pencil key, or its editor while editing. */
function FieldRow({
  label,
  editLabel,
  trigger,
  onEdit,
  children,
}: {
  label: string;
  editLabel: string;
  trigger: React.Ref<HTMLButtonElement>;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="bo-field__label">{label}</h3>
        {children}
      </div>
      <IconKey ref={trigger} icon={Pencil} label={editLabel} variant="ghost" onClick={onEdit} />
    </div>
  );
}

function ObjectiveField() {
  const { project } = useProjectDetail();
  const save = useSaveProjectField();
  const trigger = useRef<HTMLButtonElement>(null);
  const editor = useInlineEditor(trigger);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();

  function start() {
    setDraft(project.objective ?? "");
    setError(undefined);
    editor.open();
  }

  function submit() {
    const parsed = updateProjectObjectiveInputSchema.safeParse({
      id: project.id,
      objective: draft,
    });
    if (!parsed.success) {
      setError(fieldErrorsOf(parsed.error, ["objective"] as const).objective);
      input.current?.focus();
      return;
    }
    editor.close();
    if (parsed.data.objective === project.objective) return;
    save(
      "objective",
      { objective: parsed.data.objective },
      () => updateProjectObjective(parsed.data),
      { announceSaved: true },
    );
  }

  if (editor.editing) {
    return (
      <EditorForm
        label={PROJECTS_COPY.editObjective}
        onSubmit={submit}
        onCancel={editor.close}
        error={error}
      >
        <TextArea
          ref={input}
          id={fieldId}
          label={PROJECTS_COPY.objectiveLabel}
          value={draft}
          rows={3}
          autoFocus
          error={error}
          help={PROJECTS_COPY.objectiveHelp}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            // One paragraph: Enter saves (line breaks would collapse into spaces anyway).
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </EditorForm>
    );
  }

  return (
    <FieldRow
      label={PROJECTS_COPY.objectiveLabel}
      editLabel={PROJECTS_COPY.editObjective}
      trigger={trigger}
      onEdit={start}
    >
      {project.objective ? (
        <p className="bo-text-body break-words">{project.objective}</p>
      ) : (
        <p className="bo-text-body-sm text-text-secondary">{PROJECTS_COPY.objectiveEmpty}</p>
      )}
    </FieldRow>
  );
}

const DATE_FIELDS = ["startDate", "dueDate"] as const;
type DateField = (typeof DATE_FIELDS)[number];

function DatesField() {
  const { project } = useProjectDetail();
  const save = useSaveProjectField();
  const trigger = useRef<HTMLButtonElement>(null);
  const editor = useInlineEditor(trigger);
  const [start, setStart] = useState("");
  const [due, setDue] = useState("");
  const [errors, setErrors] = useState<Partial<Record<DateField, string>>>({});
  const startInput = useRef<HTMLInputElement>(null);
  const dueInput = useRef<HTMLInputElement>(null);
  const ids = useId();
  // Maintenance has no end: the field is hidden, and the saved date is kept as it is.
  const withDue = showsDueDate(project.status);

  function open() {
    setStart(project.startDate ?? "");
    setDue(project.dueDate ?? "");
    setErrors({});
    editor.open();
  }

  function submit() {
    const parsed = updateProjectDatesInputSchema.safeParse({
      id: project.id,
      startDate: start,
      dueDate: withDue ? due : project.dueDate,
    });
    if (!parsed.success) {
      const found = fieldErrorsOf(parsed.error, DATE_FIELDS);
      // With the end hidden, a start after it is the start's problem.
      if (!withDue && found.dueDate) {
        found.startDate ??= PROJECTS_COPY.startAfterHiddenDue(
          formatDateKey(project.dueDate ?? "", "short"),
        );
        delete found.dueDate;
      }
      setErrors(found);
      (found.startDate ? startInput : dueInput).current?.focus();
      return;
    }
    editor.close();
    const { startDate, dueDate } = parsed.data;
    if (startDate === project.startDate && dueDate === project.dueDate) return;
    save("dates", { startDate, dueDate }, () => updateProjectDates(parsed.data), {
      announceSaved: true,
    });
  }

  function clearError(field: DateField) {
    setErrors((previous) => {
      const next = { ...previous };
      delete next[field];
      // The end is checked against the start: fixing either clears that error.
      if (next.dueDate === PROJECT_ERRORS.dueBeforeStart) delete next.dueDate;
      return next;
    });
  }

  if (editor.editing) {
    return (
      <EditorForm
        label={PROJECTS_COPY.editDates}
        onSubmit={submit}
        onCancel={editor.close}
        error={errors.startDate ?? errors.dueDate}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            ref={startInput}
            id={`${ids}-start`}
            type="date"
            className="bo-date-field"
            label={PROJECTS_COPY.startLabel}
            value={start}
            autoFocus
            error={errors.startDate}
            help={PROJECTS_COPY.dateHelp}
            onChange={(event) => {
              setStart(event.target.value);
              clearError("startDate");
            }}
          />
          {withDue ? (
            <TextField
              ref={dueInput}
              id={`${ids}-due`}
              type="date"
              className="bo-date-field"
              label={PROJECTS_COPY.dueLabel}
              value={due}
              min={start || undefined}
              error={errors.dueDate}
              help={PROJECTS_COPY.dateHelp}
              onChange={(event) => {
                setDue(event.target.value);
                clearError("dueDate");
              }}
            />
          ) : null}
        </div>
        {withDue ? null : (
          <p className="bo-text-body-sm text-text-secondary">
            {PROJECTS_COPY.dueHiddenInMaintenance}
          </p>
        )}
      </EditorForm>
    );
  }

  const shownDue = withDue ? project.dueDate : null;
  return (
    <FieldRow
      label={PROJECTS_COPY.datesLabel}
      editLabel={PROJECTS_COPY.editDates}
      trigger={trigger}
      onEdit={open}
    >
      {project.startDate || shownDue ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {project.startDate ? (
            <DateRow label={PROJECTS_COPY.startLabel} day={project.startDate} />
          ) : null}
          {shownDue ? <DateRow label={PROJECTS_COPY.dueLabel} day={shownDue} /> : null}
        </dl>
      ) : (
        <p className="bo-text-body-sm text-text-secondary">{PROJECTS_COPY.datesEmpty}</p>
      )}
      {withDue ? null : (
        <p className="bo-text-body-sm text-text-secondary">
          {PROJECTS_COPY.dueHiddenInMaintenance}
        </p>
      )}
    </FieldRow>
  );
}

function DateRow({ label, day }: { label: string; day: string }) {
  return (
    <>
      <dt className="bo-text-body-sm text-text-secondary">{label}</dt>
      <dd className="bo-text-body">
        <time dateTime={day}>{formatDateKey(day)}</time>
      </dd>
    </>
  );
}
