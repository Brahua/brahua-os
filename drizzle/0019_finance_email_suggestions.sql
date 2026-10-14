CREATE TABLE "finance_email_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gmail_message_id" text NOT NULL,
	"source" text NOT NULL,
	"kind" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_cents" bigint,
	"currency" text,
	"merchant" text,
	"occurred_on" date,
	"card_last4" text,
	"subject" text NOT NULL,
	"sender_verified" boolean DEFAULT false NOT NULL,
	"expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "finance_email_suggestions_source_check" CHECK ("finance_email_suggestions"."source" in ('bcp', 'bbva', 'yape')),
	CONSTRAINT "finance_email_suggestions_kind_check" CHECK ("finance_email_suggestions"."kind" in ('card', 'yape', 'transfer')),
	CONSTRAINT "finance_email_suggestions_status_check" CHECK ("finance_email_suggestions"."status" in ('pending', 'registered', 'dismissed', 'unreadable')),
	CONSTRAINT "finance_email_suggestions_amount_check" CHECK ("finance_email_suggestions"."amount_cents" between 1 and 100000000),
	CONSTRAINT "finance_email_suggestions_currency_check" CHECK ("finance_email_suggestions"."currency" in ('PEN', 'USD')),
	CONSTRAINT "finance_email_suggestions_text_check" CHECK (char_length("finance_email_suggestions"."subject") <= 120
        and ("finance_email_suggestions"."merchant" is null or char_length("finance_email_suggestions"."merchant") between 1 and 80)
        and ("finance_email_suggestions"."card_last4" is null or "finance_email_suggestions"."card_last4" ~ '^[0-9]{4}$')),
	CONSTRAINT "finance_email_suggestions_reading_check" CHECK (coalesce(
        "finance_email_suggestions"."status" = 'unreadable'
        or ("finance_email_suggestions"."kind" is not null and "finance_email_suggestions"."amount_cents" is not null
          and "finance_email_suggestions"."currency" is not null and "finance_email_suggestions"."merchant" is not null
          and "finance_email_suggestions"."occurred_on" is not null),
      false)),
	CONSTRAINT "finance_email_suggestions_expense_check" CHECK (coalesce(
        ("finance_email_suggestions"."status" = 'registered' and "finance_email_suggestions"."expense_id" is not null)
        or ("finance_email_suggestions"."status" <> 'registered' and "finance_email_suggestions"."expense_id" is null),
      false))
);
--> statement-breakpoint
ALTER TABLE "finance_payment_methods" ADD COLUMN "last4" text;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD COLUMN "own_names" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_email_suggestions" ADD CONSTRAINT "finance_email_suggestions_expense_id_finance_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."finance_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_email_suggestions_message_unique" ON "finance_email_suggestions" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE INDEX "finance_email_suggestions_pending_idx" ON "finance_email_suggestions" USING btree ("created_at") WHERE "finance_email_suggestions"."status" in ('pending', 'unreadable');--> statement-breakpoint
ALTER TABLE "finance_payment_methods" ADD CONSTRAINT "finance_payment_methods_last4_check" CHECK ("finance_payment_methods"."last4" ~ '^[0-9]{4}$');--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_own_names_check" CHECK (coalesce(cardinality("finance_settings"."own_names") <= 10, false));