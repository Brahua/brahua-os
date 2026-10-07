"use client";

import { FolderKanban, LayoutGrid, ListTodo, SearchX, Tag, Tags } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { AreaTag, Icon, keyClasses } from "@/design-system";
import { TaskList } from "@/modules/tasks/components/task-list";
import {
  allViewHref,
  type FilterChoices,
  type FilterParams,
} from "@/modules/tasks/task-filters";
import type { TaskItem } from "@/modules/tasks/task-input";
import { isPendingMatching, type TaskFilters } from "@/modules/tasks/task-views";
import { TAGS_COPY } from "@/modules/tasks/tags-copy";
import { TASK_VIEW_LABELS } from "@/modules/tasks/tasks-copy";
import { VIEWS_COPY } from "@/modules/tasks/views-copy";
import { TaskFilter } from "./task-filter";
import type { FilterOption } from "./task-filter-sheet";
import { ViewEmpty, ViewHeading } from "./view-parts";

type AllViewProps = {
  /** The pending tasks that match the filters, in the view's order. */
  tasks: TaskItem[];
  filters: TaskFilters;
  choices: FilterChoices;
  /** The filters as they are in the URL (only the ones that apply). */
  params: FilterParams;
  headingId: string;
};

/**
 * "Todas" (SPEC-tasks): every pending task, by due date, priority and creation, with compact
 * filters by area and project (and, with T4, by tag) kept in the URL.
 */
export function AllView({ tasks, filters, choices, params, headingId }: AllViewProps) {
  const belongs = useCallback((task: TaskItem) => isPendingMatching(task, filters), [filters]);
  const filtered = params.area !== null || params.project !== null || params.tagId !== null;
  const area = choices.areas.find((item) => item.id === filters.areaId) ?? null;
  const project = choices.projects.find((item) => item.id === filters.projectId) ?? null;
  const tag = choices.tags.find((item) => item.id === filters.tagId) ?? null;

  const areaOptions: FilterOption[] = [
    {
      id: null,
      href: allViewHref({ ...params, area: null }),
      title: (
        <span className="bo-area-tag bo-area-tag--lg">
          <Icon icon={LayoutGrid} />
          <span>{VIEWS_COPY.allAreasOption}</span>
        </span>
      ),
    },
    ...choices.areas.map((option) => ({
      id: option.id,
      // A project of another area would leave the list empty: picking an area drops it.
      href: allViewHref({
        ...params,
        area: option.slug,
        project: project && project.area?.id === option.id ? params.project : null,
      }),
      title: (
        <AreaTag
          area={option.color}
          icon={option.icon}
          label={option.name}
          variant="large"
          className="max-w-full [&>span:last-child]:truncate"
        />
      ),
      subtitle: option.archived ? (
        <>
          {/* Heard as "Trabajo, Archivada", not "TrabajoArchivada". */}
          <span className="sr-only">, </span>
          {VIEWS_COPY.archivedArea}
        </>
      ) : undefined,
    })),
  ];

  const projectOptions: FilterOption[] = [
    {
      id: null,
      href: allViewHref({ ...params, project: null }),
      title: VIEWS_COPY.allProjectsOption,
    },
    ...choices.projects.map((option) => ({
      id: option.id,
      href: allViewHref({ ...params, project: option.id }),
      title: <span className="block truncate">{option.name}</span>,
      // With an area chosen, every project is of that area: no need to repeat it.
      subtitle: area === null && option.area ? option.area.name : undefined,
    })),
  ];

  // T4: tags by id (`?etiqueta=<tagId>`); the links keep the area and the project.
  const tagOptions: FilterOption[] = [
    {
      id: null,
      href: allViewHref({ ...params, tagId: null }),
      title: (
        <span className="inline-flex min-w-0 items-center gap-2">
          <Icon icon={Tags} size="sm" className="shrink-0 text-text-secondary" />
          {TAGS_COPY.filterAllOption}
        </span>
      ),
    },
    ...choices.tags.map((option) => ({
      id: option.id,
      href: allViewHref({ ...params, tagId: option.id }),
      title: (
        <span className="inline-flex min-w-0 max-w-full items-center gap-2">
          <Icon icon={Tag} size="sm" className="shrink-0 text-text-secondary" />
          <span className="truncate">{option.name}</span>
        </span>
      ),
    })),
  ];

  return (
    <TaskList
      tasks={tasks}
      label={VIEWS_COPY.allList}
      belongs={belongs}
      postpone
      fallbackFocusId={headingId}
      header={(count) => (
        <>
          <ViewHeading
            id={headingId}
            title={TASK_VIEW_LABELS.todas}
            count={count}
            help={VIEWS_COPY.allHelp}
          />
          <div
            role="group"
            aria-label={VIEWS_COPY.filtersLabel}
            className="flex min-w-0 flex-wrap gap-2"
            data-task-filters=""
          >
            <TaskFilter
              trigger={VIEWS_COPY.areaFilterTrigger}
              triggerName={VIEWS_COPY.areaFilterName}
              valueName={area?.name ?? VIEWS_COPY.allAreas}
              value={
                area ? (
                  <AreaTag
                    area={area.color}
                    icon={area.icon}
                    label={area.name}
                    variant="large"
                    title={area.name}
                    className="min-w-0 [&>span:last-child]:truncate"
                  />
                ) : (
                  <span className="bo-area-tag bo-area-tag--lg">
                    <Icon icon={LayoutGrid} />
                    <span>{VIEWS_COPY.allAreas}</span>
                  </span>
                )
              }
              sheetTitle={VIEWS_COPY.areaFilterTitle}
              listLabel={VIEWS_COPY.areaFilterOptions}
              options={areaOptions}
              selectedId={filters.areaId}
              nameOf={(id) => choices.areas.find((item) => item.id === id)?.name ?? null}
            />
            <TaskFilter
              trigger={VIEWS_COPY.projectFilterTrigger}
              triggerName={VIEWS_COPY.projectFilterName}
              valueName={project?.name ?? VIEWS_COPY.allProjects}
              value={
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Icon icon={FolderKanban} size="sm" className="shrink-0" />
                  <span className="truncate">{project?.name ?? VIEWS_COPY.allProjects}</span>
                </span>
              }
              sheetTitle={VIEWS_COPY.projectFilterTitle}
              listLabel={VIEWS_COPY.projectFilterOptions}
              options={projectOptions}
              selectedId={filters.projectId}
              note={
                choices.projects.length > 0
                  ? undefined
                  : area
                    ? VIEWS_COPY.noProjectsInArea(area.name)
                    : VIEWS_COPY.noProjects
              }
              nameOf={(id) => choices.projects.find((item) => item.id === id)?.name ?? null}
            />
            <TaskFilter
              trigger={TAGS_COPY.filterTrigger}
              triggerName={TAGS_COPY.filterTriggerName}
              valueName={tag?.name ?? TAGS_COPY.filterAll}
              value={
                <span className="inline-flex min-w-0 items-center gap-1.5" data-tag-filter="">
                  <Icon icon={Tag} size="sm" className="shrink-0" />
                  <span className="truncate">{tag?.name ?? TAGS_COPY.filterAll}</span>
                </span>
              }
              sheetTitle={TAGS_COPY.filterTitle}
              listLabel={TAGS_COPY.filterOptions}
              options={tagOptions}
              selectedId={filters.tagId}
              note={choices.tags.length > 0 ? undefined : TAGS_COPY.filterNone}
              nameOf={(id) => choices.tags.find((item) => item.id === id)?.name ?? null}
            />
          </div>
        </>
      )}
      empty={
        filtered ? (
          <ViewEmpty icon={SearchX} title={VIEWS_COPY.filteredEmptyTitle} view="todas">
            <p className="bo-text-body-sm text-text-secondary">{VIEWS_COPY.filteredEmptyText}</p>
            <Link
              href={allViewHref({ area: null, project: null, tagId: null })}
              prefetch={false}
              className={keyClasses({ variant: "ghost" })}
            >
              {VIEWS_COPY.clearFilters}
            </Link>
          </ViewEmpty>
        ) : (
          <ViewEmpty icon={ListTodo} title={VIEWS_COPY.allEmptyTitle} view="todas">
            <p className="bo-text-body-sm text-text-secondary">{VIEWS_COPY.allEmptyText}</p>
          </ViewEmpty>
        )
      }
    />
  );
}
