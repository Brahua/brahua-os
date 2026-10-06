CREATE TABLE "finance_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_categories_name_length_check" CHECK (char_length("finance_categories"."name") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "finance_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"description" text,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate" numeric(8, 4),
	"spent_on" date NOT NULL,
	"category_id" uuid,
	"payment_method_id" uuid,
	"recurring_payment_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_expenses_description_length_check" CHECK (char_length("finance_expenses"."description") between 1 and 80),
	CONSTRAINT "finance_expenses_amount_check" CHECK ("finance_expenses"."amount_cents" between 1 and 100000000),
	CONSTRAINT "finance_expenses_currency_check" CHECK ("finance_expenses"."currency" in ('PEN', 'USD')),
	CONSTRAINT "finance_expenses_exchange_rate_check" CHECK (coalesce((
        "finance_expenses"."currency" = 'PEN' and "finance_expenses"."exchange_rate" is null
      ) or (
        "finance_expenses"."currency" = 'USD'
        and ("finance_expenses"."exchange_rate" is null or "finance_expenses"."exchange_rate" between 1 and 10)
      ), false))
);
--> statement-breakpoint
CREATE TABLE "finance_payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'PEN' NOT NULL,
	"sort_order" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_payment_methods_name_length_check" CHECK (char_length("finance_payment_methods"."name") between 1 and 40),
	CONSTRAINT "finance_payment_methods_currency_check" CHECK ("finance_payment_methods"."currency" in ('PEN', 'USD'))
);
--> statement-breakpoint
CREATE TABLE "finance_recurring_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"amount_cents" bigint,
	"currency" text NOT NULL,
	"category_id" uuid,
	"payment_method_id" uuid,
	"cycle" text NOT NULL,
	"weekday" integer,
	"day_of_month" integer,
	"interval_months" integer,
	"anchor_month" integer,
	"start_date" date NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_recurring_payments_name_length_check" CHECK (char_length("finance_recurring_payments"."name") between 1 and 80),
	CONSTRAINT "finance_recurring_payments_notes_length_check" CHECK (char_length("finance_recurring_payments"."notes") between 1 and 500),
	CONSTRAINT "finance_recurring_payments_amount_check" CHECK ("finance_recurring_payments"."amount_cents" between 1 and 100000000),
	CONSTRAINT "finance_recurring_payments_currency_check" CHECK ("finance_recurring_payments"."currency" in ('PEN', 'USD')),
	CONSTRAINT "finance_recurring_payments_cycle_check" CHECK ("finance_recurring_payments"."cycle" in ('weekly', 'monthly', 'every_n_months', 'yearly')),
	CONSTRAINT "finance_recurring_payments_cycle_rule_check" CHECK (coalesce((
        "finance_recurring_payments"."cycle" = 'weekly'
        and "finance_recurring_payments"."weekday" between 1 and 7
        and "finance_recurring_payments"."day_of_month" is null
        and "finance_recurring_payments"."interval_months" is null
        and "finance_recurring_payments"."anchor_month" is null
      ) or (
        "finance_recurring_payments"."cycle" = 'monthly'
        and "finance_recurring_payments"."weekday" is null
        and "finance_recurring_payments"."day_of_month" between 1 and 31
        and "finance_recurring_payments"."interval_months" is null
        and "finance_recurring_payments"."anchor_month" is null
      ) or (
        "finance_recurring_payments"."cycle" = 'every_n_months'
        and "finance_recurring_payments"."weekday" is null
        and "finance_recurring_payments"."day_of_month" between 1 and 31
        and "finance_recurring_payments"."interval_months" between 2 and 12
        and "finance_recurring_payments"."anchor_month" between 1 and 12
      ) or (
        "finance_recurring_payments"."cycle" = 'yearly'
        and "finance_recurring_payments"."weekday" is null
        and "finance_recurring_payments"."day_of_month" between 1 and 31
        and "finance_recurring_payments"."interval_months" is null
        and "finance_recurring_payments"."anchor_month" between 1 and 12
      ), false))
);
--> statement-breakpoint
CREATE TABLE "finance_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"usd_to_pen" numeric(8, 4),
	"last_payment_method_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_settings_single_row_check" CHECK ("finance_settings"."id" = 1),
	CONSTRAINT "finance_settings_usd_to_pen_check" CHECK ("finance_settings"."usd_to_pen" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "finance_settlements" (
	"recurring_payment_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"status" text NOT NULL,
	"expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_settlements_recurring_payment_id_due_on_pk" PRIMARY KEY("recurring_payment_id","due_on"),
	CONSTRAINT "finance_settlements_status_check" CHECK ("finance_settlements"."status" in ('paid', 'skipped')),
	CONSTRAINT "finance_settlements_expense_check" CHECK (coalesce((
        "finance_settlements"."status" = 'paid' and "finance_settlements"."expense_id" is not null
      ) or (
        "finance_settlements"."status" = 'skipped' and "finance_settlements"."expense_id" is null
      ), false))
);
--> statement-breakpoint
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_payment_method_id_finance_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."finance_payment_methods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_expenses" ADD CONSTRAINT "finance_expenses_recurring_payment_id_finance_recurring_payments_id_fk" FOREIGN KEY ("recurring_payment_id") REFERENCES "public"."finance_recurring_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_recurring_payments" ADD CONSTRAINT "finance_recurring_payments_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_recurring_payments" ADD CONSTRAINT "finance_recurring_payments_payment_method_id_finance_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."finance_payment_methods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_last_payment_method_id_finance_payment_methods_id_fk" FOREIGN KEY ("last_payment_method_id") REFERENCES "public"."finance_payment_methods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settlements" ADD CONSTRAINT "finance_settlements_recurring_payment_id_finance_recurring_payments_id_fk" FOREIGN KEY ("recurring_payment_id") REFERENCES "public"."finance_recurring_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settlements" ADD CONSTRAINT "finance_settlements_expense_id_finance_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."finance_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_categories_name_unique" ON "finance_categories" USING btree (lower("name")) WHERE "finance_categories"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "finance_expenses_spent_on_idx" ON "finance_expenses" USING btree ("spent_on") WHERE "finance_expenses"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "finance_expenses_recurring_idx" ON "finance_expenses" USING btree ("recurring_payment_id") WHERE "finance_expenses"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_payment_methods_name_unique" ON "finance_payment_methods" USING btree (lower("name")) WHERE "finance_payment_methods"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "finance_recurring_payments_archived_idx" ON "finance_recurring_payments" USING btree ("archived_at") WHERE "finance_recurring_payments"."deleted_at" is null;