"use client";

import { Pencil } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { AREA_ICONS, AreaTag, Icon, IconKey, Led, TextField } from "@/design-system";
import { cn } from "@/lib/cn";
import { formatOwnerDay } from "@/lib/time";
import {
  focusRadioGrid,
  RadioGrid,
  type RadioGridOption,
} from "@/modules/core/components/radio-grid";
import { changeProjectArea, renameProject } from "@/modules/projects/actions";
import { dueState } from "@/modules/projects/progress";
import {
  PROJECT_ERRORS,
  renameProjectInputSchema,
  type ProjectAreaSummary,
} from "@/modules/projects/project-input";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";
import { EditorForm, fieldErrorsOf, useInlineEditor } from "./inline-editor";
import { useProjectDetail } from "./project-detail-context";
import { FieldError } from "./field-error";

type ProjectHeaderProps = {
  /** Id of the page's `<h1>` (focused right after creating). */
  headingId: string;
  /** Active life areas, in their order: the only ones a project can move to. */
  areas: readonly ProjectAreaSummary[];
  /**
   * P4 (Dependencias) slot: "Bloqueado por …" under the name while a blocker isn't done or
   * canceled. Nothing renders without it.
   */
  blockedBy?: React.ReactNode;
};

/**
 * Top of a project's page (SPEC-projects "Detalle → Cabecera"): its area and name, each editable
 * in place, and the due notice or the day it was finished.
 */
export function ProjectHeader({ headingId, areas, blockedBy }: ProjectHeaderProps) {
  return (
    <header className="flex flex-col gap-3">
      <ProjectAreaField areas={areas} />
      <ProjectNameField headingId={headingId} />
      <ProjectTimeline />
      {blockedBy}
    </header>
  );
}

function ProjectNameField({ headingId }: { headingId: string }) {
  const { project, save } = useProjectDetail();
  const trigger = useRef<HTMLButtonElement>(null);
  const editor = useInlineEditor(trigger);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  function start() {
    setDraft(project.name);
    setError(undefined);
    editor.open();
  }

  function submit() {
    const parsed = renameProjectInputSchema.safeParse({ id: project.id, name: draft });
    if (!parsed.success) {
      setError(fieldErrorsOf(parsed.error, ["name"] as const).name);
      input.current?.focus();
      return;
    }
    editor.close();
    if (parsed.data.name === project.name) return;
    save("name", { name: parsed.data.name }, () => renameProject(parsed.data));
  }

  return (
    <div className="flex items-start gap-2">
      {/* While editing, the heading stays for screen readers (the page keeps its h1). */}
      <h1
        id={headingId}
        tabIndex={-1}
        className={cn(
          "bo-text-display min-w-0 flex-1 break-words outline-none",
          editor.editing && "sr-only",
        )}
      >
        {project.name}
      </h1>
      {editor.editing ? (
        <EditorForm label={PROJECTS_COPY.editName} onSubmit={submit} onCancel={editor.close}>
          <TextField
            ref={input}
            id={fieldId}
            label={PROJECTS_COPY.nameLabel}
            value={draft}
            autoComplete="off"
            autoFocus
            required
            error={error}
            help={PROJECTS_COPY.nameHelp}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(undefined);
            }}
          />
        </EditorForm>
      ) : (
        <IconKey
          ref={trigger}
          icon={Pencil}
          label={PROJECTS_COPY.editName}
          variant="ghost"
          onClick={start}
        />
      )}
    </div>
  );
}

function ProjectAreaField({ areas }: { areas: readonly ProjectAreaSummary[] }) {
  const { project, save } = useProjectDetail();
  const trigger = useRef<HTMLButtonElement>(null);
  const editor = useInlineEditor(trigger);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const group = useRef<HTMLDivElement>(null);
  const ids = useId();
  const labelId = `${ids}-label`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const archived = !areas.some((area) => area.id === project.area.id);
  // Only an area still offered counts as picked (one archived meanwhile drops out by itself).
  const value = areas.some((area) => area.id === picked) ? picked : null;

  // Opening moves focus into the picker (on the current area, or the first one).
  useEffect(() => {
    if (editor.editing) focusRadioGrid(group.current);
  }, [editor.editing]);

  function start() {
    setPicked(archived ? null : project.area.id);
    setError(undefined);
    editor.open();
  }

  function submit() {
    const area = areas.find((item) => item.id === value);
    if (!area) {
      setError(PROJECT_ERRORS.area);
      focusRadioGrid(group.current);
      return;
    }
    editor.close();
    if (area.id === project.area.id) return;
    save("area", { area }, () => changeProjectArea({ id: project.id, lifeAreaId: area.id }));
  }

  const options: RadioGridOption<string>[] = areas.map((area) => ({
    value: area.id,
    label: area.name,
    children: (
      <>
        <Led area={area.color} size="sm" />
        <Icon icon={AREA_ICONS[area.icon]} size="sm" />
        <span className="bo-option-key__label" title={area.name}>
          {area.name}
        </span>
      </>
    ),
  }));

  if (editor.editing) {
    return (
      <EditorForm label={PROJECTS_COPY.changeArea} onSubmit={submit} onCancel={editor.close}>
        <div className={cn("bo-field", error && "is-error")}>
          <span id={labelId} className="bo-field__label">
            {PROJECTS_COPY.areaLabel}
          </span>
          {areas.length === 0 ? (
            <p id={hintId} className="bo-text-body-sm text-text-secondary">
              {PROJECTS_COPY.noAreasToMove}
            </p>
          ) : (
            <>
              <RadioGrid
                ref={group}
                options={options}
                value={value}
                onValueChange={(next) => {
                  setPicked(next);
                  setError(undefined);
                }}
                labelledBy={labelId}
                describedBy={error ? `${hintId} ${errorId}` : hintId}
                errorId={error ? errorId : undefined}
                invalid={Boolean(error)}
                required
                className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2"
                itemClassName="bo-option-key min-w-0"
              />
              <span id={hintId} className="bo-field__help">
                {archived ? PROJECTS_COPY.areaArchived : PROJECTS_COPY.areaPickerHint}
              </span>
            </>
          )}
          {error ? <FieldError id={errorId} message={error} /> : null}
        </div>
      </EditorForm>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <AreaTag
        area={project.area.color}
        icon={project.area.icon}
        label={project.area.name}
        className="min-w-0 max-w-full [&>span:last-child]:break-words"
      />
      {archived ? (
        <span className="bo-text-label text-text-secondary">{PROJECTS_COPY.areaArchivedShort}</span>
      ) : null}
      <IconKey
        ref={trigger}
        icon={Pencil}
        label={PROJECTS_COPY.changeArea}
        variant="ghost"
        onClick={start}
      />
    </div>
  );
}

/** "Vence en 3 días" (idea, active, paused) or "Terminado el …" (done), from the page's instant. */
function ProjectTimeline() {
  const { project, now } = useProjectDetail();
  if (project.status === "done" && project.completedAt) {
    return (
      <p className="bo-text-label text-text-secondary" data-completed>
        <time dateTime={project.completedAt.toISOString()}>
          {PROJECTS_COPY.completedOn(formatOwnerDay(project.completedAt))}
        </time>
      </p>
    );
  }
  const due = dueState(project.dueDate, project.status, now);
  if (!due) return null;
  const urgent = due.kind === "today" || due.kind === "overdue";
  return (
    <p
      className={cn(
        "bo-text-label flex items-center gap-2",
        urgent ? "text-signal-text" : "text-text-secondary",
      )}
    >
      {urgent ? <Led signal size="sm" /> : null}
      <time dateTime={project.dueDate ?? undefined} data-due={due.kind}>
        {due.label}
      </time>
    </p>
  );
}
