CREATE TABLE "learning_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "learning_steps_title_check" CHECK (char_length("learning_steps"."title") between 1 and 200),
	CONSTRAINT "learning_steps_position_check" CHECK ("learning_steps"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "learning_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"project_id" uuid,
	"url" text,
	"weekly_target_minutes" integer,
	"target_date" date,
	"position" integer NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "learning_tracks_title_check" CHECK (char_length("learning_tracks"."title") between 1 and 120),
	CONSTRAINT "learning_tracks_kind_check" CHECK ("learning_tracks"."kind" in ('certification', 'course', 'book', 'practice')),
	CONSTRAINT "learning_tracks_status_check" CHECK ("learning_tracks"."status" in ('active', 'waiting', 'done')),
	CONSTRAINT "learning_tracks_finished_check" CHECK (("learning_tracks"."status" = 'done') = ("learning_tracks"."finished_at" is not null)),
	CONSTRAINT "learning_tracks_url_check" CHECK ("learning_tracks"."url" is null or ("learning_tracks"."url" ~ '^https?://[^[:space:]]+$' and char_length("learning_tracks"."url") <= 2000)),
	CONSTRAINT "learning_tracks_weekly_target_check" CHECK ("learning_tracks"."weekly_target_minutes" is null or "learning_tracks"."weekly_target_minutes" between 15 and 3000),
	CONSTRAINT "learning_tracks_target_date_check" CHECK ("learning_tracks"."target_date" is null or "learning_tracks"."target_date" between '2000-01-01'::date and '2100-12-31'::date),
	CONSTRAINT "learning_tracks_position_check" CHECK ("learning_tracks"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "learning_steps" ADD CONSTRAINT "learning_steps_track_id_learning_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."learning_tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_tracks" ADD CONSTRAINT "learning_tracks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_steps_track_idx" ON "learning_steps" USING btree ("track_id","position") WHERE "learning_steps"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "learning_tracks_status_idx" ON "learning_tracks" USING btree ("status","position") WHERE "learning_tracks"."deleted_at" is null;