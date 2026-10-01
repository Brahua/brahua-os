"use client";

import { Check, Lock, Plus, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { startTransition, useId, useOptimistic, useRef, useState } from "react";
import { Icon, IconKey, Key, ListRow, SectionLabel } from "@/design-system";
import type { ActionResult } from "@/lib/action-result";
import type { Queued } from "@/lib/use-save-queue";
import { addDependency, removeDependency } from "@/modules/projects/actions";
import { isBlocking, type DependencyProject } from "@/modules/projects/dependency-input";
import {
  DEPENDENCIES_COPY,
  PROJECT_STATUS_LABELS,
  PROJECTS_COPY,
} from "@/modules/projects/projects-copy";
import { projectPath } from "@/modules/projects/routes";
import { useProjectDetail } from "./project-detail-context";

// The sheet (Radix Dialog and the search) loads on demand, as soon as the key is pointed at,
// focused or touched.
const loadSheet = () => import("./dependency-picker-sheet");
const DependencyPickerSheet = dynamic(() =>
  loadSheet().then((loaded) => loaded.DependencyPickerSheet),
);
const preload = () => void loadSheet();

type ProjectDependenciesSectionProps = {
  /** Its blockers (not deleted), blocking or not, by name. */
  blockers: readonly DependencyProject[];
  /** The projects it may add (see selectProjectDependencies). */
  candidates: readonly DependencyProject[];
};

type BlockerChange = { kind: "remove"; id: string } | { kind: "add"; blocker: DependencyProject };

const collator = new Intl.Collator("es");

function applyBlockerChange(
  blockers: readonly DependencyProject[],
  change: BlockerChange,
): readonly DependencyProject[] {
  const rest = blockers.filter(
    (blocker) => blocker.id !== (change.kind === "remove" ? change.id : change.blocker.id),
  );
  if (change.kind === "remove") return rest;
  return [...rest, change.blocker].sort((a, b) => collator.compare(a.name, b.name));
}

/** The server's message for the field when it gives one, else its general one. */
function reasonOf(queued: Queued<ActionResult<unknown>>): string {
  if (queued.kind !== "done") return PROJECTS_COPY.checkConnection;
  const result = queued.value;
  if (result.ok) return "";
  return result.fieldErrors?.blockedById?.[0] ?? result.error;
}

/**
 * "Bloqueado por" (P4, SPEC-projects "Dependencias"): the projects that must end before this
 * one, each a link with its state and a key to remove it ("Deshacer" in the notice), and
 * "Agregar bloqueador", which opens a searchable sheet of candidates.
 *
 * Removing is optimistic (its own useOptimistic; the server's answer revalidates the page).
 * Adding waits for the server inside the sheet: only the database can tell a cycle made
 * meanwhile, and its refusal shows on the search field.
 */
export function ProjectDependenciesSection({
  blockers,
  candidates,
}: ProjectDependenciesSectionProps) {
  const { project, enqueue, toaster, announce } = useProjectDetail();
  const { push } = toaster;
  const [shown, applyChange] = useOptimistic(blockers, applyBlockerChange);
  const ids = useId();
  const headingId = `${ids}-heading`;
  const helpId = `${ids}-help`;
  const addKey = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  // Said once the sheet has closed (live regions behind a modal are not read).
  const added = useRef<string | null>(null);

  const key = (blockerId: string) => `dependency:${project.id}:${blockerId}`;
  const input = (blockerId: string) => ({ id: project.id, blockedById: blockerId });

  function add(candidate: DependencyProject) {
    setPending(candidate.id);
    setError(undefined);
    startTransition(async () => {
      const queued = await enqueue(key(candidate.id), () => addDependency(input(candidate.id)));
      setPending(null);
      if (queued.kind === "skipped") return;
      if (queued.kind === "done" && queued.value.ok) {
        // The action's revalidation brings the new row with this transition.
        added.current = candidate.name;
        setOpen(false);
        return;
      }
      setError(reasonOf(queued));
      search.current?.focus();
    });
  }

  function undoRemove(blocker: DependencyProject) {
    startTransition(async () => {
      applyChange({ kind: "add", blocker });
      const queued = await enqueue(key(blocker.id), () => addDependency(input(blocker.id)));
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        push({
          title: DEPENDENCIES_COPY.restoredTitle,
          text: DEPENDENCIES_COPY.restored(blocker.name),
        });
        return;
      }
      push({
        title: PROJECTS_COPY.notSavedTitle,
        text: `${DEPENDENCIES_COPY.notRestored(blocker.name)} ${reasonOf(queued)}`,
        tone: "error",
      });
    });
  }

  function remove(blocker: DependencyProject) {
    // Its key unmounts: focus goes to "Agregar bloqueador", never to <body>.
    addKey.current?.focus();
    startTransition(async () => {
      applyChange({ kind: "remove", id: blocker.id });
      const queued = await enqueue(key(blocker.id), () => removeDependency(input(blocker.id)));
      if (queued.kind === "skipped" || queued.superseded) return;
      if (queued.kind === "done" && queued.value.ok) {
        push({
          title: DEPENDENCIES_COPY.removedTitle,
          text: DEPENDENCIES_COPY.removed(blocker.name),
          action: { label: PROJECTS_COPY.undo, run: () => undoRemove(blocker) },
        });
        return;
      }
      push({
        title: PROJECTS_COPY.notSavedTitle,
        text: `${DEPENDENCIES_COPY.notRemoved(blocker.name)} ${reasonOf(queued)}`,
        tone: "error",
      });
    });
  }

  return (
    <section aria-labelledby={headingId} aria-describedby={helpId} className="flex flex-col gap-3">
      <SectionLabel id={headingId} as="h2" title={DEPENDENCIES_COPY.section} />
      <div className="bo-card gap-4">
        <p id={helpId} className="bo-text-body-sm text-text-secondary">
          {DEPENDENCIES_COPY.sectionHelp}
        </p>
        {shown.length > 0 ? (
          <ul className="bo-list" aria-label={DEPENDENCIES_COPY.blockerList}>
            {shown.map((blocker) => {
              const blocking = isBlocking(blocker.status);
              return (
                <li key={blocker.id} className="flex" data-blocker={blocker.id}>
                  <ListRow
                    // The name's link covers the row (after:inset-0); the ✕ sits above it.
                    className="relative"
                    leading={
                      <Icon
                        icon={blocking ? Lock : Check}
                        size="sm"
                        className="shrink-0 text-text-secondary"
                      />
                    }
                    title={
                      <Link
                        href={projectPath(blocker.id)}
                        prefetch={false}
                        className="break-words rounded-sm underline underline-offset-4 after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      >
                        {blocker.name}
                      </Link>
                    }
                    subtitle={
                      <>
                        {PROJECT_STATUS_LABELS[blocker.status]}
                        {blocking ? null : (
                          <>
                            <span aria-hidden> · </span>
                            <span className="sr-only">, </span>
                            {DEPENDENCIES_COPY.notBlocking}
                          </>
                        )}
                      </>
                    }
                    trailing={
                      <IconKey
                        icon={X}
                        label={DEPENDENCIES_COPY.remove(blocker.name)}
                        variant="ghost"
                        placement="top"
                        className="relative z-10"
                        onClick={() => remove(blocker)}
                      />
                    }
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="bo-text-body-sm">{DEPENDENCIES_COPY.empty}</p>
        )}
        <Key
          ref={addKey}
          icon={Plus}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="w-full sm:w-fit"
          onPointerEnter={preload}
          onFocus={preload}
          onTouchStart={preload}
          onClick={() => {
            setError(undefined);
            setOpened(true);
            setOpen(true);
          }}
        >
          {DEPENDENCIES_COPY.add}
        </Key>
      </div>
      {opened ? (
        <DependencyPickerSheet
          open={open}
          onOpenChange={setOpen}
          candidates={candidates}
          pendingId={pending}
          error={error}
          onSearchChange={() => setError(undefined)}
          onPick={add}
          onClosed={() => {
            if (added.current) announce(DEPENDENCIES_COPY.addedAnnounce(added.current));
            added.current = null;
          }}
          returnFocusRef={addKey}
          searchRef={search}
        />
      ) : null}
    </section>
  );
}
