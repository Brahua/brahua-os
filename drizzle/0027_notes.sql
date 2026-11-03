CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"day" date,
	"title" text,
	"body" text DEFAULT '' NOT NULL,
	"area_id" uuid,
	"pinned_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "notes_kind_check" CHECK ("notes"."kind" in ('daily', 'page')),
	CONSTRAINT "notes_day_check" CHECK (("notes"."kind" = 'daily') = ("notes"."day" is not null) and ("notes"."day" is null or "notes"."day" between '2000-01-01'::date and '2100-12-31'::date)),
	CONSTRAINT "notes_title_check" CHECK (("notes"."kind" = 'page') = ("notes"."title" is not null) and ("notes"."title" is null or char_length("notes"."title") between 1 and 120)),
	CONSTRAINT "notes_body_check" CHECK (char_length("notes"."body") <= 50000),
	CONSTRAINT "notes_page_fields_check" CHECK ("notes"."kind" = 'page' or ("notes"."area_id" is null and "notes"."pinned_at" is null)),
	CONSTRAINT "notes_version_check" CHECK ("notes"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_area_id_core_life_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."core_life_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notes_daily_day_unique" ON "notes" USING btree ("day") WHERE "notes"."kind" = 'daily' and "notes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "notes_updated_idx" ON "notes" USING btree ("updated_at") WHERE "notes"."deleted_at" is null;