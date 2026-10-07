ALTER TABLE "finance_recurring_payments" ADD COLUMN "installments_total" integer;--> statement-breakpoint
ALTER TABLE "finance_recurring_payments" ADD CONSTRAINT "finance_recurring_payments_installments_check" CHECK (coalesce("finance_recurring_payments"."installments_total" is null or (
        "finance_recurring_payments"."installments_total" between 1 and 120 and "finance_recurring_payments"."cycle" = 'monthly'
      ), false));