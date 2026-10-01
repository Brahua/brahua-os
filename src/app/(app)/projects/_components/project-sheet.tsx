"use client";

import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AREA_ICONS, Icon, Key, Led, Sheet, TextField } from "@/design-system";
import { fail, type ActionResult, type FieldErrors } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { FieldError } from "@/modules/core/components/field-error";
import {
  focusRadioGrid,
  RadioGrid,
  type RadioGridOption,
} from "@/modules/core/components/radio-grid";
import { createProject } from "@/modules/projects/actions";
import {
  CREATE_PROJECT_FIELDS,
  CREATE_PROJECT_STATUSES,
  createProjectInputSchema,
  type CreateProjectField,
  type ProjectAreaSummary,
  type ProjectSummary,
} from "@/modules/projects/project-input";
import { PROJECT_STATUS_LABELS, PROJECTS_COPY } from "@/modules/projects/projects-copy";
import { CREATED_PARAM } from "@/modules/projects/routes";

type CreateStatus = (typeof CREATE_PROJECT_STATUSES)[number];

export type ProjectSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active life areas, in their order: the only ones a new project can go in. */
  areas: readonly ProjectAreaSummary[];
  /** Area picked when the sheet opens (the list's filter, if it is an active area). */
  defaultAreaId: string | null;
  /** Where focus goes if the sheet closes without creating (the "Nuevo proyecto" key). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
};

type Errors = Partial<Record<CreateProjectField, string>>;

function firstErrors(fieldErrors: FieldErrors | undefined): Errors {
  const errors: Errors = {};
  for (const field of CREATE_PROJECT_FIELDS) {
    const message = fieldErrors?.[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

const STATUS_OPTIONS: RadioGridOption<CreateStatus>[] = CREATE_PROJECT_STATUSES.map((status) => ({
  value: status,
  label: PROJECT_STATUS_LABELS[status],
  children: <span className="truncate">{PROJECT_STATUS_LABELS[status]}</span>,
}));

/**
 * Create a project in a few taps (SPEC-projects: under 10 s on the phone): name, area and
 * state (Idea unless changed). Validates on the client with the action's own schema, then the
 * Server Action validates again (the authority). On success it goes to the project's page; the
 * key keeps saying "Creando…" until that page is on screen.
 */
export function ProjectSheet({
  open,
  onOpenChange,
  areas,
  defaultAreaId,
  returnFocusRef,
}: ProjectSheetProps) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const [name, setName] = useState("");
  const [pickedAreaId, setLifeAreaId] = useState<string | null>(defaultAreaId);
  // Only an area that is still offered counts as picked: after "areaUnavailable" the page
  // brings the current areas, and an archived one drops out of the selection by itself.
  const lifeAreaId = areas.some((area) => area.id === pickedAreaId) ? pickedAreaId : null;
  const [status, setStatus] = useState<CreateStatus>("idea");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Set by a failed submit; the next commit moves focus to the first invalid field.
  const focusFirstInvalid = useRef(false);

  const ids = useId();
  const formId = `${ids}-form`;
  const nameInput = useRef<HTMLInputElement>(null);
  const areaGroup = useRef<HTMLDivElement>(null);
  const statusGroup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusFirstInvalid.current) return;
    focusFirstInvalid.current = false;
    const first = CREATE_PROJECT_FIELDS.find((field) => errors[field]);
    if (first === "name") nameInput.current?.focus();
    else if (first === "lifeAreaId") focusRadioGrid(areaGroup.current);
    else if (first === "status") focusRadioGrid(statusGroup.current);
  });

  // While saving (and navigating), the sheet stays open: Esc, the scrim, ✕ and Cancelar do nothing.
  function requestOpenChange(next: boolean) {
    if (!next && pending) return;
    onOpenChange(next);
  }

  function showErrors(result: { error: string; fieldErrors?: FieldErrors }) {
    const fieldErrors = firstErrors(result.fieldErrors);
    focusFirstInvalid.current = true;
    setErrors(fieldErrors);
    const other = Object.values(result.fieldErrors ?? {}).find((messages) => messages.length)?.[0];
    setFormError(Object.keys(fieldErrors).length > 0 ? null : (other ?? result.error));
  }

  function clearError(field: CreateProjectField) {
    setErrors((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Without active areas there is nothing to create in (the key says why).
    if (pending || areas.length === 0) return;
    const parsed = createProjectInputSchema.safeParse({ name, lifeAreaId, status });
    if (!parsed.success) {
      const failed = fail(parsed.error);
      if (!failed.ok) showErrors(failed);
      return;
    }
    setFormError(null);
    startTransition(async () => {
      let result: ActionResult<ProjectSummary>;
      try {
        result = await createProject(parsed.data);
      } catch {
        // Network failure or a new deployment: the action itself never throws.
        result = fail(PROJECTS_COPY.unexpected);
      }
      if (!result.ok) {
        showErrors(result);
        return;
      }
      const { id } = result.data;
      // Part of this transition: "Creando…" stays until the project's page is on screen.
      // `created`: the page moves focus to its heading and announces it.
      startTransition(() => router.push(`/projects/${id}?${CREATED_PARAM}=1`));
    });
  }

  const areaOptions: RadioGridOption<string>[] = areas.map((area) => ({
    value: area.id,
    label: area.name,
    children: (
      <>
        <Led area={area.color} size="sm" />
        <Icon icon={AREA_ICONS[area.icon]} size="sm" />
        {/* Up to two lines: long area names stay readable on the phone. */}
        <span className="bo-option-key__label" title={area.name}>
          {area.name}
        </span>
      </>
    ),
  }));

  const areaLabelId = `${ids}-area-label`;
  const areaHintId = `${ids}-area-hint`;
  const areaErrorId = `${ids}-area-error`;
  const statusLabelId = `${ids}-status-label`;
  const statusErrorId = `${ids}-status-error`;
  const noAreas = areas.length === 0;

  return (
    <Sheet
      open={open}
      onOpenChange={requestOpenChange}
      variant={isDesktop ? "side" : "bottom"}
      title={PROJECTS_COPY.newProject}
      returnFocusRef={returnFocusRef}
      closeDisabled={pending}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={pending || undefined}
            onClick={() => requestOpenChange(false)}
          >
            {PROJECTS_COPY.cancel}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className={cn("flex-1", noAreas && "is-disabled")}
            aria-disabled={pending || noAreas || undefined}
            aria-describedby={noAreas ? areaHintId : undefined}
          >
            {pending ? PROJECTS_COPY.creating : PROJECTS_COPY.create}
          </Key>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-6">
        <TextField
          ref={nameInput}
          label={PROJECTS_COPY.nameLabel}
          name="name"
          value={name}
          autoComplete="off"
          autoFocus
          required
          error={errors.name}
          help={PROJECTS_COPY.nameHelp}
          id={`${ids}-name`}
          onChange={(event) => {
            setName(event.target.value);
            if (errors.name) clearError("name");
          }}
        />

        <div className={cn("bo-field", errors.lifeAreaId && "is-error")}>
          <span id={areaLabelId} className="bo-field__label">
            {PROJECTS_COPY.areaLabel}
          </span>
          {noAreas ? (
            <p id={areaHintId} className="bo-text-body-sm text-text-secondary">
              {PROJECTS_COPY.noAreas}
            </p>
          ) : (
            <>
              <RadioGrid
                ref={areaGroup}
                options={areaOptions}
                value={lifeAreaId}
                onValueChange={(value) => {
                  setLifeAreaId(value);
                  if (errors.lifeAreaId) clearError("lifeAreaId");
                }}
                labelledBy={areaLabelId}
                describedBy={errors.lifeAreaId ? `${areaHintId} ${areaErrorId}` : areaHintId}
                errorId={errors.lifeAreaId ? areaErrorId : undefined}
                invalid={Boolean(errors.lifeAreaId)}
                required
                className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2"
                itemClassName="bo-option-key min-w-0"
              />
              <span id={areaHintId} className="bo-field__help">
                {PROJECTS_COPY.areaHint}
              </span>
            </>
          )}
          {errors.lifeAreaId ? <FieldError id={areaErrorId} message={errors.lifeAreaId} /> : null}
        </div>

        <div className={cn("bo-field", errors.status && "is-error")}>
          <span id={statusLabelId} className="bo-field__label">
            {PROJECTS_COPY.statusLabel}
          </span>
          <RadioGrid
            ref={statusGroup}
            options={STATUS_OPTIONS}
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              if (errors.status) clearError("status");
            }}
            labelledBy={statusLabelId}
            describedBy={errors.status ? statusErrorId : undefined}
            errorId={errors.status ? statusErrorId : undefined}
            invalid={Boolean(errors.status)}
            className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2"
            itemClassName="min-w-0"
          />
          {errors.status ? <FieldError id={statusErrorId} message={errors.status} /> : null}
        </div>

        {formError ? (
          <p role="alert" className="bo-field__error">
            <Icon icon={TriangleAlert} size="sm" />
            {formError}
          </p>
        ) : null}
        {/* The key's text changes too, but a screen reader on another control wouldn't hear it. */}
        <p role="status" className="sr-only">
          {pending ? PROJECTS_COPY.creatingStatus : ""}
        </p>
      </form>
    </Sheet>
  );
}
