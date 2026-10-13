CREATE TABLE "goal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"entry_date" date NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_entries_delta_check" CHECK ("goal_entries"."delta" <> 0 and abs("goal_entries"."delta") <= 100000)
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"period_kind" text NOT NULL,
	"year" integer NOT NULL,
	"quarter" integer,
	"source_kind" text NOT NULL,
	"habit_id" uuid,
	"project_id" uuid,
	"target" integer NOT NULL,
	"unit" text,
	"area_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"achieved_at" timestamp with time zone,
	"position" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_title_length_check" CHECK (char_length("goals"."title") between 1 and 80),
	CONSTRAINT "goals_notes_length_check" CHECK (char_length("goals"."notes") between 1 and 2000),
	CONSTRAINT "goals_unit_length_check" CHECK (char_length("goals"."unit") between 1 and 20),
	CONSTRAINT "goals_period_kind_check" CHECK ("goals"."period_kind" in ('year', 'quarter')),
	CONSTRAINT "goals_source_kind_check" CHECK ("goals"."source_kind" in ('habit', 'project', 'manual')),
	CONSTRAINT "goals_status_check" CHECK ("goals"."status" in ('active', 'achieved', 'archived')),
	CONSTRAINT "goals_year_check" CHECK ("goals"."year" between 2000 and 2100),
	CONSTRAINT "goals_quarter_rule_check" CHECK (coalesce((
        "goals"."period_kind" = 'year' and "goals"."quarter" is null
      ) or (
        "goals"."period_kind" = 'quarter' and "goals"."quarter" between 1 and 4
      ), false)),
	CONSTRAINT "goals_source_rule_check" CHECK (coalesce((
        "goals"."source_kind" = 'habit'
        and "goals"."habit_id" is not null
        and "goals"."project_id" is null
        and "goals"."unit" is null
        and "goals"."target" between 1 and 100000
      ) or (
        "goals"."source_kind" = 'project'
        and "goals"."project_id" is not null
        and "goals"."habit_id" is null
        and "goals"."unit" is null
        and "goals"."target" = 100
      ) or (
        "goals"."source_kind" = 'manual'
        and "goals"."unit" is not null
        and "goals"."habit_id" is null
        and "goals"."project_id" is null
        and "goals"."target" between 1 and 100000
      ), false))
);
--> statement-breakpoint
CREATE TABLE "weekly_objectives" (
	"week_start" date PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_objectives_text_length_check" CHECK (char_length("weekly_objectives"."text") between 1 and 140),
	CONSTRAINT "weekly_objectives_monday_check" CHECK (extract(isodow from "weekly_objectives"."week_start") = 1)
);
--> statement-breakpoint
ALTER TABLE "goal_entries" ADD CONSTRAINT "goal_entries_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_area_id_core_life_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."core_life_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_entries_goal_idx" ON "goal_entries" USING btree ("goal_id","created_at") WHERE "goal_entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "goals_position_idx" ON "goals" USING btree ("position") WHERE "goals"."deleted_at" is null;