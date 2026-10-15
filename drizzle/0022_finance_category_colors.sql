ALTER TABLE "finance_categories" ADD COLUMN "color_slot" smallint;--> statement-breakpoint
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_color_slot_check" CHECK ("finance_categories"."color_slot" is null or "finance_categories"."color_slot" between 1 and 8);--> statement-breakpoint
-- Backfill by current order (archived ones too: their old expenses keep showing); idempotent.
UPDATE "finance_categories" AS c SET "color_slot" = ranked.slot
FROM (
  SELECT "id", ((row_number() OVER (ORDER BY "sort_order", "created_at", "id") - 1) % 8 + 1)::smallint AS slot
  FROM "finance_categories"
) AS ranked
WHERE c."id" = ranked."id" AND c."color_slot" IS NULL;
