CREATE TABLE "weekly_reviews" (
	"week_start" date PRIMARY KEY NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_reviews_monday_check" CHECK (extract(isodow from "weekly_reviews"."week_start") = 1),
	CONSTRAINT "weekly_reviews_note_length_check" CHECK ("weekly_reviews"."note" is null or char_length("weekly_reviews"."note") between 1 and 280)
);
