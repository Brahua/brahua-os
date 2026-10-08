ALTER TABLE "habits" ADD COLUMN "reminder_time" time;--> statement-breakpoint
ALTER TABLE "habits" ADD COLUMN "daypart" text;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_reminder_time_check" CHECK ("habits"."reminder_time" is null or (
        "habits"."kind" <> 'avoid'
        and "habits"."reminder_time" >= time '00:00'
        and "habits"."reminder_time" < time '24:00'
        and extract(second from "habits"."reminder_time") = 0
      ));--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_daypart_check" CHECK ("habits"."daypart" in ('morning', 'afternoon', 'evening'));