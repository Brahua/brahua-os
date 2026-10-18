-- hitos-agrupan-tareas H2: a milestone is a phase that groups tasks and is complete when all of them
-- are (its state is derived from the tasks, `done_at` is no longer read). The data moves first, in
-- the same migration (one transaction), and only then the CHECK that needs it.
--
-- 1) A task that repeats leaves its milestone: its next occurrence would reopen the phase every time.
-- It stays in the project (only the milestone link goes).
UPDATE "tasks" SET "milestone_id" = NULL, "updated_at" = now()
WHERE "milestone_id" IS NOT NULL AND "recurrence_kind" IS NOT NULL;--> statement-breakpoint
-- 2) A live milestone with no live task becomes ONE task of the same project and milestone, with
-- its title and its date: done (at the milestone's `done_at`) if the milestone was, pending if it
-- was not. Nothing is lost: the progress the milestone gave is now the task's. The id is derived
-- from the milestone's (md5 → uuid), so running it again inserts nothing. A milestone that already
-- has tasks keeps them and its old `done_at` is simply ignored (its state comes from the tasks).
INSERT INTO "tasks" ("id", "title", "priority", "due_date", "done_at", "project_id", "milestone_id", "created_at", "updated_at")
SELECT
  md5('milestone-task:' || m."id"::text)::uuid,
  m."title",
  'medium',
  m."due_date",
  m."done_at",
  m."project_id",
  m."id",
  now(),
  now()
FROM "project_milestones" m
WHERE m."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "tasks" t WHERE t."milestone_id" = m."id" AND t."deleted_at" IS NULL
  )
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_not_recurring_check" CHECK ("tasks"."milestone_id" is null or "tasks"."recurrence_kind" is null);
