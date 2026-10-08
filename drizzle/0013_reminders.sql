CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "push_subscriptions_user_agent_check" CHECK ("push_subscriptions"."user_agent" is null or char_length("push_subscriptions"."user_agent") <= 200)
);
--> statement-breakpoint
CREATE TABLE "reminder_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"telegram_message_id" bigint,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_deliveries_kind_check" CHECK ("reminder_deliveries"."kind" in ('briefing', 'payment_eve', 'payment_followup', 'evening_review', 'habit_time')),
	CONSTRAINT "reminder_deliveries_channel_check" CHECK ("reminder_deliveries"."channel" in ('push', 'telegram')),
	CONSTRAINT "reminder_deliveries_status_check" CHECK ("reminder_deliveries"."status" in ('pending', 'sent', 'skipped', 'failed')),
	CONSTRAINT "reminder_deliveries_attempts_check" CHECK ("reminder_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reminder_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"delivery_channel" text DEFAULT 'push' NOT NULL,
	"briefing_enabled" boolean DEFAULT true NOT NULL,
	"briefing_time" time DEFAULT '07:30' NOT NULL,
	"payments_enabled" boolean DEFAULT true NOT NULL,
	"evening_enabled" boolean DEFAULT true NOT NULL,
	"evening_time" time DEFAULT '21:00' NOT NULL,
	"habit_times_enabled" boolean DEFAULT true NOT NULL,
	"show_amounts_telegram" boolean DEFAULT true NOT NULL,
	"show_amounts_push" boolean DEFAULT false NOT NULL,
	"telegram_chat_id" bigint,
	"linked_at" timestamp with time zone,
	"telegram_blocked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_settings_single_row_check" CHECK ("reminder_settings"."id" = true),
	CONSTRAINT "reminder_settings_delivery_channel_check" CHECK ("reminder_settings"."delivery_channel" in ('push', 'telegram', 'both')),
	CONSTRAINT "reminder_settings_times_check" CHECK (extract(second from "reminder_settings"."briefing_time") = 0 and extract(second from "reminder_settings"."evening_time") = 0),
	CONSTRAINT "reminder_settings_link_check" CHECK (("reminder_settings"."telegram_chat_id" is null) = ("reminder_settings"."linked_at" is null) and ("reminder_settings"."telegram_blocked_at" is null or "reminder_settings"."telegram_chat_id" is null))
);
--> statement-breakpoint
CREATE TABLE "telegram_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"update_id" bigint NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_captures_update_id_unique" UNIQUE("update_id"),
	CONSTRAINT "telegram_captures_entity_kind_check" CHECK ("telegram_captures"."entity_kind" in ('task', 'expense'))
);
--> statement-breakpoint
CREATE TABLE "telegram_link_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_captures" ADD CONSTRAINT "telegram_captures_update_id_telegram_updates_update_id_fk" FOREIGN KEY ("update_id") REFERENCES "public"."telegram_updates"("update_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_deliveries_dedupe_channel_unique" ON "reminder_deliveries" USING btree ("dedupe_key","channel");--> statement-breakpoint
CREATE INDEX "reminder_deliveries_scheduled_for_idx" ON "reminder_deliveries" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "telegram_link_attempts_chat_created_idx" ON "telegram_link_attempts" USING btree ("chat_id","created_at");