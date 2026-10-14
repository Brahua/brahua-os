CREATE TABLE "household_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"category" text DEFAULT 'otros' NOT NULL,
	"quantity" text,
	"status" text DEFAULT 'needed' NOT NULL,
	"bought_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "household_products_name_check" CHECK (char_length("household_products"."name") between 1 and 80 and char_length("household_products"."name_key") between 1 and 80 and "household_products"."name_key" = lower("household_products"."name_key")),
	CONSTRAINT "household_products_category_check" CHECK ("household_products"."category" in ('verduras', 'frutas', 'carnes', 'lacteos', 'especerias', 'productos_naturales', 'limpieza', 'otros')),
	CONSTRAINT "household_products_status_check" CHECK ("household_products"."status" in ('idle', 'needed', 'bought')),
	CONSTRAINT "household_products_quantity_check" CHECK ("household_products"."quantity" is null or char_length("household_products"."quantity") between 1 and 30),
	CONSTRAINT "household_products_bought_check" CHECK (("household_products"."status" = 'bought') = ("household_products"."bought_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "household_products_name_key_unique" ON "household_products" USING btree ("name_key") WHERE "household_products"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "household_products_status_idx" ON "household_products" USING btree ("status") WHERE "household_products"."deleted_at" is null;