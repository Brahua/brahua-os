CREATE TABLE "task_tag_links" (
	"task_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "task_tag_links_task_id_tag_id_pk" PRIMARY KEY("task_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "task_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_tags_name_unique" UNIQUE("name"),
	CONSTRAINT "task_tags_name_check" CHECK (char_length("task_tags"."name") between 1 and 30 and "task_tags"."name" = lower("task_tags"."name"))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"due_date" date,
	"done_at" timestamp with time zone,
	"life_area_id" uuid,
	"project_id" uuid,
	"milestone_id" uuid,
	"is_next_action" boolean DEFAULT false NOT NULL,
	"recurrence_kind" text,
	"recurrence_interval" integer,
	"recurrence_weekdays" integer[],
	"recurrence_month_day" integer,
	"spawned_from_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" in ('low', 'medium', 'high')),
	CONSTRAINT "tasks_title_length_check" CHECK (char_length("tasks"."title") between 1 and 200),
	CONSTRAINT "tasks_notes_length_check" CHECK (char_length("tasks"."notes") between 1 and 20000),
	CONSTRAINT "tasks_area_or_project_check" CHECK ("tasks"."life_area_id" is null or "tasks"."project_id" is null),
	CONSTRAINT "tasks_milestone_project_check" CHECK ("tasks"."milestone_id" is null or "tasks"."project_id" is not null),
	CONSTRAINT "tasks_next_action_check" CHECK (not "tasks"."is_next_action" or ("tasks"."project_id" is not null and "tasks"."done_at" is null)),
	CONSTRAINT "tasks_spawned_from_check" CHECK ("tasks"."spawned_from_id" <> "tasks"."id"),
	CONSTRAINT "tasks_recurrence_kind_check" CHECK ("tasks"."recurrence_kind" in ('every_days', 'every_weeks', 'every_months', 'weekdays', 'month_day')),
	CONSTRAINT "tasks_recurrence_check" CHECK (coalesce((
        "tasks"."recurrence_kind" is null
        and "tasks"."recurrence_interval" is null
        and "tasks"."recurrence_weekdays" is null
        and "tasks"."recurrence_month_day" is null
      ) or (
        "tasks"."recurrence_kind" in ('every_days', 'every_weeks', 'every_months')
        and "tasks"."recurrence_interval" between 1 and 365
        and "tasks"."recurrence_weekdays" is null
        and "tasks"."recurrence_month_day" is null
      ) or (
        "tasks"."recurrence_kind" = 'weekdays'
        and "tasks"."recurrence_interval" is null
        and "tasks"."recurrence_month_day" is null
        and array_ndims("tasks"."recurrence_weekdays") = 1
        and array_lower("tasks"."recurrence_weekdays", 1) = 1
        and cardinality("tasks"."recurrence_weekdays") between 1 and 7
        and array_position("tasks"."recurrence_weekdays", null) is null
        and "tasks"."recurrence_weekdays" <@ array[1, 2, 3, 4, 5, 6, 7]
        and (cardinality("tasks"."recurrence_weekdays") < 2 or "tasks"."recurrence_weekdays"[1] < "tasks"."recurrence_weekdays"[2])
        and (cardinality("tasks"."recurrence_weekdays") < 3 or "tasks"."recurrence_weekdays"[2] < "tasks"."recurrence_weekdays"[3])
        and (cardinality("tasks"."recurrence_weekdays") < 4 or "tasks"."recurrence_weekdays"[3] < "tasks"."recurrence_weekdays"[4])
        and (cardinality("tasks"."recurrence_weekdays") < 5 or "tasks"."recurrence_weekdays"[4] < "tasks"."recurrence_weekdays"[5])
        and (cardinality("tasks"."recurrence_weekdays") < 6 or "tasks"."recurrence_weekdays"[5] < "tasks"."recurrence_weekdays"[6])
        and (cardinality("tasks"."recurrence_weekdays") < 7 or "tasks"."recurrence_weekdays"[6] < "tasks"."recurrence_weekdays"[7])
      ) or (
        "tasks"."recurrence_kind" = 'month_day'
        and "tasks"."recurrence_interval" is null
        and "tasks"."recurrence_weekdays" is null
        and "tasks"."recurrence_month_day" between 1 and 31
      ), false))
);
--> statement-breakpoint
ALTER TABLE "task_tag_links" ADD CONSTRAINT "task_tag_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tag_links" ADD CONSTRAINT "task_tag_links_tag_id_task_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."task_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_life_area_id_core_life_areas_id_fk" FOREIGN KEY ("life_area_id") REFERENCES "public"."core_life_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_spawned_from_id_tasks_id_fk" FOREIGN KEY ("spawned_from_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_tag_links_tag_id_idx" ON "task_tag_links" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_next_action_unique" ON "tasks" USING btree ("project_id") WHERE "tasks"."is_next_action" and "tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_due_date_idx" ON "tasks" USING btree ("due_date") WHERE "tasks"."done_at" is null and "tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_project_id_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_life_area_id_idx" ON "tasks" USING btree ("life_area_id");--> statement-breakpoint
CREATE INDEX "tasks_milestone_id_idx" ON "tasks" USING btree ("milestone_id");