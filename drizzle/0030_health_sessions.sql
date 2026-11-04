CREATE TABLE "health_session_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"rest_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "health_session_exercises_rest_check" CHECK ("health_session_exercises"."rest_seconds" is null or "health_session_exercises"."rest_seconds" between 30 and 600),
	CONSTRAINT "health_session_exercises_position_check" CHECK ("health_session_exercises"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "health_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"note" text,
	"habit_marked_day" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "health_sessions_note_check" CHECK ("health_sessions"."note" is null or char_length("health_sessions"."note") <= 500),
	CONSTRAINT "health_sessions_ended_check" CHECK ("health_sessions"."ended_at" is null or "health_sessions"."ended_at" >= "health_sessions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "health_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"weight_grams" integer,
	"reps" integer,
	"seconds" integer,
	"distance_meters" integer,
	"warmup" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "health_sets_weight_check" CHECK ("health_sets"."weight_grams" is null or ("health_sets"."weight_grams" between 0 and 1000000 and "health_sets"."weight_grams" % 250 = 0)),
	CONSTRAINT "health_sets_reps_check" CHECK ("health_sets"."reps" is null or "health_sets"."reps" between 1 and 999),
	CONSTRAINT "health_sets_seconds_check" CHECK ("health_sets"."seconds" is null or "health_sets"."seconds" between 1 and 36000),
	CONSTRAINT "health_sets_distance_check" CHECK ("health_sets"."distance_meters" is null or "health_sets"."distance_meters" between 0 and 1000000),
	CONSTRAINT "health_sets_position_check" CHECK ("health_sets"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "health_session_exercises" ADD CONSTRAINT "health_session_exercises_session_id_health_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."health_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_session_exercises" ADD CONSTRAINT "health_session_exercises_exercise_id_health_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."health_exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_sessions" ADD CONSTRAINT "health_sessions_routine_id_health_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."health_routines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_sets" ADD CONSTRAINT "health_sets_session_exercise_id_health_session_exercises_id_fk" FOREIGN KEY ("session_exercise_id") REFERENCES "public"."health_session_exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_session_exercises_session_idx" ON "health_session_exercises" USING btree ("session_id","position") WHERE "health_session_exercises"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "health_session_exercises_exercise_idx" ON "health_session_exercises" USING btree ("exercise_id") WHERE "health_session_exercises"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "health_sessions_open_unique" ON "health_sessions" USING btree ((true)) WHERE "health_sessions"."ended_at" is null and "health_sessions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "health_sessions_started_idx" ON "health_sessions" USING btree ("started_at") WHERE "health_sessions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "health_sessions_routine_idx" ON "health_sessions" USING btree ("routine_id") WHERE "health_sessions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "health_sets_exercise_idx" ON "health_sets" USING btree ("session_exercise_id","position") WHERE "health_sets"."deleted_at" is null;