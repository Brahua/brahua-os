"use client";

import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Icon, Key, SegmentedControl, Sheet, TextArea, TextField } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { FieldError } from "@/modules/core/components/field-error";
import { MAX_ACTIVE_TRACKS, TRACK_KINDS, type TrackKind } from "../learning-constants";
import { KIND_LABELS, LEARNING_COPY as COPY, LEARNING_ERRORS } from "../learning-copy";
import { joinMinutes, splitMinutes } from "../pace";
import { parseSyllabus } from "../syllabus";
import { createTrack, updateTrack } from "../tracks-actions";
import {
  createTrackInputSchema,
  TRACK_FIELDS,
  updateTrackInputSchema,
  type CreateResult,
  type ProjectChoice,
  type TrackField,
  type TrackItem,
  type TrackRef,
} from "../tracks-input";
import { useLearningSave } from "./use-learning-save";

export type TrackFormMode =
  /** «Nuevo frente»: `active` are the tracks in progress (the limit's choice names them). */
  | { kind: "create"; active: TrackRef[] }
  /** «Ajustes» of a track. */
  | { kind: "edit"; track: TrackItem };

export type TrackFormSaved =
  { kind: "create"; data: CreateResult } | { kind: "edit"; data: TrackItem };

type TrackFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The key that opened it: focus comes back here. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  mode: TrackFormMode;
  projects: readonly ProjectChoice[];
  onSaved: (saved: TrackFormSaved) => void;
  /** After the sheet fully closed (announce here: the page is no longer aria-hidden). */
  onClosed?: () => void;
};

type Errors = Partial<Record<TrackField, string>>;

/** The fields each fold holds: an error there opens it before focusing. */
const RHYTHM_FIELDS: readonly TrackField[] = ["weeklyTargetMinutes", "targetDate"];
const MORE_FIELDS: readonly TrackField[] = ["projectId", "url"];

/**
 * «Nuevo frente» and «Ajustes» (SPEC-learning "Pantallas"): name, kind, the pasted syllabus (one
 * step per line; not for a practice) and whether it starts in progress, then folded the weekly
 * target and the target date, and the project and the course's link. With 2 in progress already,
 * starting in progress asks which one moves to «En espera». The same sheet the other modules use
 * (bottom on the phone, side panel on the desktop): it stays open with the error on its field when
 * the save is refused. Mount it with a new `key` on each opening (its fields start from props).
 */
export function TrackFormSheet({
  open,
  onOpenChange,
  returnFocusRef,
  mode,
  projects,
  onSaved,
  onClosed,
}: TrackFormSheetProps) {
  const isDesktop = useIsDesktop();
  const { send } = useLearningSave();
  const ids = useId();
  const formId = `${ids}-form`;
  const titleInput = useRef<HTMLInputElement>(null);
  const editing = mode.kind === "edit" ? mode.track : null;
  const active = mode.kind === "create" ? mode.active : [];
  const full = active.length >= MAX_ACTIVE_TRACKS;
  const weekly = splitMinutes(editing?.weeklyTargetMinutes ?? null);

  const [title, setTitle] = useState(editing?.title ?? "");
  const [kind, setKind] = useState<TrackKind>(editing?.kind ?? "course");
  const [syllabus, setSyllabus] = useState("");
  const [status, setStatus] = useState<"active" | "waiting">(full ? "waiting" : "active");
  const [pauseTrackId, setPauseTrackId] = useState("");
  const [hours, setHours] = useState(weekly.hours);
  const [minutes, setMinutes] = useState(weekly.minutes);
  const [targetDate, setTargetDate] = useState(editing?.targetDate ?? "");
  const [projectId, setProjectId] = useState(editing?.projectId ?? "");
  const [url, setUrl] = useState(editing?.url ?? "");
  const [rhythmOpen, setRhythmOpen] = useState(
    editing !== null && (editing.weeklyTargetMinutes !== null || editing.targetDate !== null),
  );
  const [moreOpen, setMoreOpen] = useState(
    editing !== null && (editing.projectId !== null || editing.url !== null),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const practice = kind === "practice";
  const asksPause = mode.kind === "create" && status === "active" && full;
  const preview = practice || mode.kind === "edit" ? null : parseSyllabus(syllabus);

  function clear(field: TrackField) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function showErrors(next: Errors) {
    setErrors(next);
    const first = TRACK_FIELDS.find((field) => next[field]);
    if (!first) return;
    if (RHYTHM_FIELDS.includes(first)) setRhythmOpen(true);
    if (MORE_FIELDS.includes(first)) setMoreOpen(true);
    // After the fold opens (its fields render on the next commit).
    requestAnimationFrame(() => document.getElementById(`${ids}-${first}`)?.focus());
  }

  function input() {
    const fields = {
      title,
      kind,
      projectId,
      url,
      weeklyTargetMinutes: joinMinutes(hours, minutes),
      targetDate,
    };
    if (mode.kind === "edit") return { ...fields, id: mode.track.id };
    return {
      ...fields,
      syllabus: practice ? "" : syllabus,
      status,
      pauseTrackId: asksPause ? pauseTrackId : "",
    };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const data = input();
    const parsed = (
      mode.kind === "edit" ? updateTrackInputSchema : createTrackInputSchema
    ).safeParse(data);
    const next: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as TrackField;
        next[field] ??= issue.message;
      }
    }
    if (asksPause && pauseTrackId === "") next.pauseTrackId ??= LEARNING_ERRORS.limitReached;
    if (Object.keys(next).length > 0) {
      showErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    const result: ActionResult<CreateResult | TrackItem> =
      mode.kind === "edit"
        ? await send(() => updateTrack(data))
        : await send(() => createTrack(data));
    setSaving(false);
    if (!result.ok) {
      const refused: Errors = {};
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if ((TRACK_FIELDS as readonly string[]).includes(field)) {
          refused[field as TrackField] = messages[0];
        }
      }
      if (Object.keys(refused).length === 0) refused.title = result.error;
      showErrors(refused);
      return;
    }
    onSaved(
      mode.kind === "edit"
        ? { kind: "edit", data: result.data as TrackItem }
        : { kind: "create", data: result.data as CreateResult },
    );
    onOpenChange(false);
  }

  const syllabusHelp =
    preview && preview.ok && syllabus.trim() !== ""
      ? `${COPY.syllabusCount(preview.titles.length)} ${COPY.syllabusHelp}`
      : COPY.syllabusHelp;
  const syllabusError =
    errors.syllabus ??
    (preview && !preview.ok
      ? preview.error === "tooMany"
        ? LEARNING_ERRORS.syllabusTooMany
        : preview.error === "tooBig"
          ? LEARNING_ERRORS.syllabusTooBig
          : preview.error === "tooLong"
            ? LEARNING_ERRORS.syllabusTooLong(preview.line ?? 0)
            : LEARNING_ERRORS.syllabusInvisible(preview.line ?? 0)
      : undefined);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
      variant={isDesktop ? "side" : "bottom"}
      title={mode.kind === "edit" ? COPY.editSheetTitle : COPY.newSheetTitle}
      returnFocusRef={returnFocusRef}
      initialFocusRef={isDesktop ? titleInput : undefined}
      focusTitleOnOpen={!isDesktop}
      closeDisabled={saving}
      onClosed={onClosed}
      footer={
        <>
          <Key
            variant="ghost"
            className="flex-1 lg:flex-none"
            aria-disabled={saving || undefined}
            onClick={() => {
              if (!saving) onOpenChange(false);
            }}
          >
            {COPY.cancel}
          </Key>
          <Key
            type="submit"
            form={formId}
            variant="signal"
            className="flex-1"
            aria-disabled={saving || undefined}
            data-track-form-submit=""
          >
            {mode.kind === "edit" ? COPY.save : COPY.create}
          </Key>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-5"
        data-saving={saving || undefined}
      >
        <TextField
          ref={titleInput}
          id={`${ids}-title`}
          label={COPY.titleLabel}
          placeholder={COPY.titlePlaceholder}
          autoComplete="off"
          value={title}
          error={errors.title}
          onChange={(event) => {
            setTitle(event.target.value);
            clear("title");
          }}
        />
        <div className={cn("bo-field", errors.kind && "is-error")}>
          <label className="bo-field__label" htmlFor={`${ids}-kind`}>
            {COPY.kindLabel}
          </label>
          <div className="bo-select">
            <select
              id={`${ids}-kind`}
              className="bo-field__control"
              value={kind}
              aria-invalid={Boolean(errors.kind)}
              aria-describedby={errors.kind ? `${ids}-kind-error` : undefined}
              onChange={(event) => {
                setKind(event.target.value as TrackKind);
                clear("kind");
                clear("syllabus");
              }}
            >
              {TRACK_KINDS.map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value]}
                </option>
              ))}
            </select>
            <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
          </div>
          {errors.kind ? <FieldError id={`${ids}-kind-error`} message={errors.kind} /> : null}
          {practice ? <span className="bo-field__help">{COPY.practiceNote}</span> : null}
        </div>
        {mode.kind === "create" && !practice ? (
          <TextArea
            id={`${ids}-syllabus`}
            label={COPY.syllabusLabel}
            help={syllabusHelp}
            rows={6}
            value={syllabus}
            error={syllabusError}
            data-track-syllabus=""
            onChange={(event) => {
              setSyllabus(event.target.value);
              clear("syllabus");
            }}
          />
        ) : null}
        {mode.kind === "create" ? (
          <div className="flex flex-col gap-3">
            <div className="bo-field">
              <span aria-hidden className="bo-field__label">
                {COPY.statusLabel}
              </span>
              <SegmentedControl
                mode="radio"
                touch
                label={COPY.statusLabel}
                options={[
                  { value: "active", label: COPY.statusOptions.active },
                  { value: "waiting", label: COPY.statusOptions.waiting },
                ]}
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  clear("pauseTrackId");
                }}
              />
            </div>
            {asksPause ? (
              <div
                className={cn("bo-field", errors.pauseTrackId && "is-error")}
                data-track-pause-choice=""
              >
                <p className="bo-text-body-sm text-text-secondary">{COPY.fullNote}</p>
                <label className="bo-field__label" htmlFor={`${ids}-pauseTrackId`}>
                  {COPY.pauseChoiceLabel}
                </label>
                <div className="bo-select">
                  <select
                    id={`${ids}-pauseTrackId`}
                    className="bo-field__control"
                    value={pauseTrackId}
                    aria-invalid={Boolean(errors.pauseTrackId)}
                    aria-describedby={errors.pauseTrackId ? `${ids}-pauseTrackId-error` : undefined}
                    onChange={(event) => {
                      setPauseTrackId(event.target.value);
                      clear("pauseTrackId");
                    }}
                  >
                    <option value="">{COPY.pauseNone}</option>
                    {active.map((track) => (
                      <option key={track.id} value={track.id}>
                        {track.title}
                      </option>
                    ))}
                  </select>
                  <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
                </div>
                {errors.pauseTrackId ? (
                  <FieldError id={`${ids}-pauseTrackId-error`} message={errors.pauseTrackId} />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <Fold
          id={`${ids}-rhythm`}
          title={COPY.rhythm}
          help={COPY.rhythmHelp}
          open={rhythmOpen}
          onOpenChange={setRhythmOpen}
        >
          <fieldset
            className={cn("bo-field", errors.weeklyTargetMinutes && "is-error")}
            aria-describedby={
              errors.weeklyTargetMinutes ? `${ids}-weekly-error` : `${ids}-weekly-help`
            }
          >
            <legend className="bo-field__label mb-2">{COPY.weeklyLabel}</legend>
            <div className="grid grid-cols-2 gap-3">
              <TextField
                id={`${ids}-weeklyTargetMinutes`}
                label={COPY.hoursLabel}
                inputMode="numeric"
                autoComplete="off"
                value={hours}
                aria-invalid={Boolean(errors.weeklyTargetMinutes)}
                onChange={(event) => {
                  setHours(event.target.value);
                  clear("weeklyTargetMinutes");
                }}
              />
              <TextField
                id={`${ids}-weekly-minutes`}
                label={COPY.minutesLabel}
                inputMode="numeric"
                autoComplete="off"
                value={minutes}
                aria-invalid={Boolean(errors.weeklyTargetMinutes)}
                onChange={(event) => {
                  setMinutes(event.target.value);
                  clear("weeklyTargetMinutes");
                }}
              />
            </div>
            {errors.weeklyTargetMinutes ? (
              <FieldError id={`${ids}-weekly-error`} message={errors.weeklyTargetMinutes} />
            ) : (
              <span id={`${ids}-weekly-help`} className="bo-field__help">
                {COPY.weeklyHelp}
              </span>
            )}
          </fieldset>
          <TextField
            id={`${ids}-targetDate`}
            type="date"
            className="bo-date-field"
            label={COPY.dateLabel}
            help={COPY.dateHelp}
            value={targetDate}
            error={errors.targetDate}
            onChange={(event) => {
              setTargetDate(event.target.value);
              clear("targetDate");
            }}
          />
        </Fold>

        <Fold
          id={`${ids}-more`}
          title={COPY.more}
          help={COPY.moreHelp}
          open={moreOpen}
          onOpenChange={setMoreOpen}
        >
          <div className={cn("bo-field", errors.projectId && "is-error")}>
            <label className="bo-field__label" htmlFor={`${ids}-projectId`}>
              {COPY.projectLabel}
            </label>
            <div className="bo-select">
              <select
                id={`${ids}-projectId`}
                className="bo-field__control"
                value={projectId}
                aria-invalid={Boolean(errors.projectId)}
                aria-describedby={errors.projectId ? `${ids}-projectId-error` : undefined}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  clear("projectId");
                }}
              >
                <option value="">{COPY.projectNone}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <Icon icon={ChevronDown} size="sm" className="bo-select__chevron" />
            </div>
            {errors.projectId ? (
              <FieldError id={`${ids}-projectId-error`} message={errors.projectId} />
            ) : null}
          </div>
          <TextField
            id={`${ids}-url`}
            type="url"
            inputMode="url"
            autoComplete="off"
            label={COPY.urlLabel}
            help={COPY.urlHelp}
            value={url}
            error={errors.url}
            onChange={(event) => {
              setUrl(event.target.value);
              clear("url");
            }}
          />
        </Fold>
      </form>
    </Sheet>
  );
}

/** A folded group of optional fields: a heading-like toggle, a line of help and its fields. */
function Fold({
  id,
  title,
  help,
  open,
  onOpenChange,
  children,
}: {
  id: string;
  title: string;
  help: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
        className="bo-section-label min-h-11 cursor-pointer rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="bo-section-label__title">{title}</span>
        <Icon icon={ChevronDown} size="sm" className={cn(open && "rotate-180")} />
      </button>
      <p className="bo-text-body-sm px-1 text-text-secondary">{help}</p>
      <div id={id} hidden={!open} className="mt-2 flex flex-col gap-5">
        {open ? children : null}
      </div>
    </div>
  );
}
