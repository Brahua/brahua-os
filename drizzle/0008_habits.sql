CREATE TABLE "habit_logs" (
	"habit_id" uuid NOT NULL,
	"day" date NOT NULL,
	"quantity" integer NOT NULL,
	"target" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habit_logs_habit_id_day_pk" PRIMARY KEY("habit_id","day"),
	CONSTRAINT "habit_logs_quantity_check" CHECK ("habit_logs"."quantity" between 0 and 99999),
	CONSTRAINT "habit_logs_target_check" CHECK ("habit_logs"."target" >= 1)
);
--> statement-breakpoint
CREATE TABLE "habit_pauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"habit_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habit_pauses_dates_check" CHECK ("habit_pauses"."end_date" >= "habit_pauses"."start_date" and "habit_pauses"."end_date" - "habit_pauses"."start_date" < 90),
	CONSTRAINT "habit_pauses_reason_length_check" CHECK (char_length("habit_pauses"."reason") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"identity" text,
	"cue" text,
	"kind" text DEFAULT 'build' NOT NULL,
	"life_area_id" uuid,
	"measure" text NOT NULL,
	"goal" integer DEFAULT 1 NOT NULL,
	"unit" text,
	"step" integer DEFAULT 1 NOT NULL,
	"frequency" text NOT NULL,
	"weekly_target" integer,
	"weekdays" integer[],
	"start_date" date NOT NULL,
	"sort_order" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habits_name_length_check" CHECK (char_length("habits"."name") between 1 and 80),
	CONSTRAINT "habits_identity_length_check" CHECK (char_length("habits"."identity") between 1 and 120),
	CONSTRAINT "habits_cue_length_check" CHECK (char_length("habits"."cue") between 1 and 60),
	CONSTRAINT "habits_unit_length_check" CHECK (char_length("habits"."unit") between 1 and 20),
	CONSTRAINT "habits_kind_check" CHECK ("habits"."kind" in ('build', 'avoid')),
	CONSTRAINT "habits_measure_check" CHECK ("habits"."measure" in ('check', 'quantity')),
	CONSTRAINT "habits_frequency_check" CHECK ("habits"."frequency" in ('daily', 'weekly_count', 'weekdays')),
	CONSTRAINT "habits_avoid_check" CHECK (coalesce("habits"."kind" <> 'avoid' or ("habits"."measure" = 'check' and "habits"."frequency" = 'daily'), false)),
	CONSTRAINT "habits_measure_rule_check" CHECK (coalesce((
        "habits"."measure" = 'check'
        and "habits"."goal" = 1
        and "habits"."step" = 1
        and "habits"."unit" is null
      ) or (
        "habits"."measure" = 'quantity'
        and "habits"."unit" is not null
        and "habits"."goal" between 1 and 10000
        and "habits"."step" between 1 and "habits"."goal"
      ), false)),
	CONSTRAINT "habits_frequency_rule_check" CHECK (coalesce((
        "habits"."frequency" = 'daily'
        and "habits"."weekly_target" is null
        and "habits"."weekdays" is null
      ) or (
        "habits"."frequency" = 'weekly_count'
        and "habits"."weekly_target" between 1 and 6
        and "habits"."weekdays" is null
      ) or (
        "habits"."frequency" = 'weekdays'
        and "habits"."weekly_target" is null
        and array_ndims("habits"."weekdays") = 1
        and array_lower("habits"."weekdays", 1) = 1
        and cardinality("habits"."weekdays") between 1 and 6
        and array_position("habits"."weekdays", null) is null
        and "habits"."weekdays" <@ array[1, 2, 3, 4, 5, 6, 7]
        and (cardinality("habits"."weekdays") < 2 or "habits"."weekdays"[1] < "habits"."weekdays"[2])
        and (cardinality("habits"."weekdays") < 3 or "habits"."weekdays"[2] < "habits"."weekdays"[3])
        and (cardinality("habits"."weekdays") < 4 or "habits"."weekdays"[3] < "habits"."weekdays"[4])
        and (cardinality("habits"."weekdays") < 5 or "habits"."weekdays"[4] < "habits"."weekdays"[5])
        and (cardinality("habits"."weekdays") < 6 or "habits"."weekdays"[5] < "habits"."weekdays"[6])
      ), false))
);
--> statement-breakpoint
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_pauses" ADD CONSTRAINT "habit_pauses_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_life_area_id_core_life_areas_id_fk" FOREIGN KEY ("life_area_id") REFERENCES "public"."core_life_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "habit_pauses_habit_start_idx" ON "habit_pauses" USING btree ("habit_id","start_date") WHERE "habit_pauses"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "habits_sort_order_idx" ON "habits" USING btree ("sort_order") WHERE "habits"."deleted_at" is null and "habits"."archived_at" is null;