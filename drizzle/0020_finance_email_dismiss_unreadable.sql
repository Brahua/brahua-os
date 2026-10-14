ALTER TABLE "finance_email_suggestions" DROP CONSTRAINT "finance_email_suggestions_reading_check";--> statement-breakpoint
ALTER TABLE "finance_email_suggestions" ADD CONSTRAINT "finance_email_suggestions_reading_check" CHECK (coalesce(
        "finance_email_suggestions"."status" in ('unreadable', 'dismissed')
        or ("finance_email_suggestions"."kind" is not null and "finance_email_suggestions"."amount_cents" is not null
          and "finance_email_suggestions"."currency" is not null and "finance_email_suggestions"."merchant" is not null
          and "finance_email_suggestions"."occurred_on" is not null),
      false));