ALTER TABLE "tasks" ADD COLUMN "due_time" time;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_due_time_check" CHECK ("tasks"."due_time" is null or (
        "tasks"."due_date" is not null
        and "tasks"."due_time" >= time '00:00'
        and "tasks"."due_time" < time '24:00'
        and extract(second from "tasks"."due_time") = 0
      ));