CREATE TABLE "household_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"meal_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"weekdays" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "household_recipes_name_check" CHECK (char_length("household_recipes"."name") between 1 and 120),
	CONSTRAINT "household_recipes_meal_types_check" CHECK ("household_recipes"."meal_types" <@ ARRAY['breakfast', 'midmorning', 'lunch', 'afternoon', 'snack', 'dinner']::text[] and cardinality("household_recipes"."meal_types") <= 6),
	CONSTRAINT "household_recipes_weekdays_check" CHECK ("household_recipes"."weekdays" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[] and cardinality("household_recipes"."weekdays") <= 7),
	CONSTRAINT "household_recipes_url_check" CHECK ("household_recipes"."url" is null or ("household_recipes"."url" ~ '^https?://[^[:space:]]+$' and char_length("household_recipes"."url") <= 2000))
);
--> statement-breakpoint
CREATE INDEX "household_recipes_name_idx" ON "household_recipes" USING btree ("name") WHERE "household_recipes"."deleted_at" is null;