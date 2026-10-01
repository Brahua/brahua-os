CREATE TABLE "project_dependencies" (
	"project_id" uuid NOT NULL,
	"blocked_by_id" uuid NOT NULL,
	CONSTRAINT "project_dependencies_project_id_blocked_by_id_pk" PRIMARY KEY("project_id","blocked_by_id"),
	CONSTRAINT "project_dependencies_self_check" CHECK ("project_dependencies"."project_id" <> "project_dependencies"."blocked_by_id")
);
--> statement-breakpoint
CREATE TABLE "project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"sort_order" integer NOT NULL,
	CONSTRAINT "project_links_url_check" CHECK (char_length("project_links"."url") <= 2048 and "project_links"."url" ~* '^https?://[^[:space:]]+$'),
	CONSTRAINT "project_links_label_length_check" CHECK (char_length("project_links"."label") between 1 and 80),
	CONSTRAINT "project_links_sort_order_check" CHECK ("project_links"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"done_at" timestamp with time zone,
	"sort_order" integer NOT NULL,
	CONSTRAINT "project_milestones_title_length_check" CHECK (char_length("project_milestones"."title") between 1 and 120),
	CONSTRAINT "project_milestones_sort_order_check" CHECK ("project_milestones"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"objective" text,
	"notes" text,
	"status" text DEFAULT 'idea' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"life_area_id" uuid NOT NULL,
	"start_date" date,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('idea', 'active', 'paused', 'maintenance', 'done', 'canceled')),
	CONSTRAINT "projects_priority_check" CHECK ("projects"."priority" in ('low', 'medium', 'high')),
	CONSTRAINT "projects_name_length_check" CHECK (char_length("projects"."name") between 1 and 80),
	CONSTRAINT "projects_objective_length_check" CHECK (char_length("projects"."objective") between 1 and 280),
	CONSTRAINT "projects_notes_length_check" CHECK (char_length("projects"."notes") between 1 and 20000),
	CONSTRAINT "projects_dates_check" CHECK ("projects"."due_date" >= "projects"."start_date"),
	CONSTRAINT "projects_completed_at_check" CHECK (("projects"."status" = 'done') = ("projects"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_blocked_by_id_projects_id_fk" FOREIGN KEY ("blocked_by_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_life_area_id_core_life_areas_id_fk" FOREIGN KEY ("life_area_id") REFERENCES "public"."core_life_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_dependencies_blocked_by_id_idx" ON "project_dependencies" USING btree ("blocked_by_id");--> statement-breakpoint
CREATE INDEX "project_links_project_order_idx" ON "project_links" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX "project_milestones_project_order_idx" ON "project_milestones" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status") WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_life_area_id_idx" ON "projects" USING btree ("life_area_id");