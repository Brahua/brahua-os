CREATE TABLE "learning_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "learning_sessions_source_check" CHECK ("learning_sessions"."source" in ('timer', 'manual')),
	CONSTRAINT "learning_sessions_minutes_check" CHECK (("learning_sessions"."ended_at" is null) = ("learning_sessions"."minutes" is null) and ("learning_sessions"."minutes" is null or "learning_sessions"."minutes" between 1 and 600)),
	CONSTRAINT "learning_sessions_ended_check" CHECK ("learning_sessions"."ended_at" is null or "learning_sessions"."ended_at" >= "learning_sessions"."started_at"),
	CONSTRAINT "learning_sessions_manual_check" CHECK ("learning_sessions"."source" = 'timer' or "learning_sessions"."ended_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_track_id_learning_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."learning_tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_sessions_running_unique" ON "learning_sessions" USING btree ((true)) WHERE "learning_sessions"."ended_at" is null and "learning_sessions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "learning_sessions_track_idx" ON "learning_sessions" USING btree ("track_id","started_at") WHERE "learning_sessions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "learning_sessions_started_idx" ON "learning_sessions" USING btree ("started_at") WHERE "learning_sessions"."deleted_at" is null;