"use client";

import { Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Icon, Key } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/cn";
import { deleteProject } from "@/modules/projects/actions";
import type { DeletedProject } from "@/modules/projects/project-input";
import { PROJECTS_COPY } from "@/modules/projects/projects-copy";
import { DELETED_PARAM, PROJECTS_PATH } from "@/modules/projects/routes";
import { useProjectDetail } from "./project-detail-context";

/**
 * "Eliminar proyecto" with a confirm step on the page (no browser dialog). Deleting is a soft
 * delete: the page goes back to the list, which shows "Proyecto eliminado · Deshacer"
 * (`?deleted=<id>`, see ProjectsNotices). Until it is done, nothing changes here.
 */
export function ProjectDeleteSection() {
  const { project } = useProjectDetail();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = useId();
  const titleId = `${ids}-title`;
  const textId = `${ids}-text`;
  const openKey = useRef<HTMLButtonElement>(null);
  const cancelKey = useRef<HTMLButtonElement>(null);
  // Which key gets focus after the next render: the panel's "Cancelar" on opening, the
  // "Eliminar proyecto" key on closing (the one that had focus unmounts either way).
  const focusNext = useRef<"cancel" | "open" | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "cancel") cancelKey.current?.focus();
    else if (target === "open") openKey.current?.focus();
  }, [confirming]);

  function open() {
    setError(null);
    focusNext.current = "cancel";
    setConfirming(true);
  }

  function cancel() {
    if (pending) return;
    focusNext.current = "open";
    setConfirming(false);
  }

  function confirm() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      let result: ActionResult<DeletedProject>;
      try {
        result = await deleteProject({ id: project.id });
      } catch {
        result = fail(PROJECTS_COPY.unexpected);
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Replace: going back must not land on the deleted project's 404.
      startTransition(() =>
        router.replace(`${PROJECTS_PATH}?${DELETED_PARAM}=${encodeURIComponent(project.id)}`),
      );
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-divider pt-6">
      {confirming ? (
        <div
          role="group"
          aria-labelledby={titleId}
          aria-describedby={textId}
          className="bo-card max-w-160 gap-4"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }}
        >
          <p id={titleId} className="bo-text-body-strong break-words">
            {PROJECTS_COPY.deleteConfirmTitle(project.name)}
          </p>
          <p id={textId} className="bo-text-body-sm text-text-secondary">
            {PROJECTS_COPY.deleteConfirmText}
          </p>
          {error ? (
            <p role="alert" className="bo-field__error">
              <Icon icon={TriangleAlert} size="sm" />
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Key
              ref={cancelKey}
              variant="ghost"
              aria-disabled={pending || undefined}
              className={cn(pending && "is-disabled")}
              onClick={cancel}
            >
              {PROJECTS_COPY.cancel}
            </Key>
            <Key
              variant="signal"
              icon={Trash2}
              aria-disabled={pending || undefined}
              className={cn(pending && "is-disabled")}
              onClick={confirm}
            >
              {pending ? PROJECTS_COPY.deleting : PROJECTS_COPY.deleteConfirm}
            </Key>
          </div>
          {/* The key's text changes too, but a screen reader on "Cancelar" wouldn't hear it. */}
          <p role="status" className="sr-only">
            {pending ? PROJECTS_COPY.deleting : ""}
          </p>
        </div>
      ) : (
        <Key ref={openKey} variant="ghost" icon={Trash2} className="w-fit" onClick={open}>
          {PROJECTS_COPY.delete}
        </Key>
      )}
    </div>
  );
}
